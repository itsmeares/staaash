import type { FirstRunKind } from "../../components/public/first-run";
import { photoSamples, sampleFiles } from "./fixtures";
import type { InferResponseType } from "hono/client";
import type { api } from "../../lib/api";
import type { Plain } from "../../lib/plain";
import { plain } from "../../lib/plain";
import type { FileSummary, FolderSummary } from "../../server/files/types";
import type { RecentClientItem } from "../../src/workspace/recent/recent-helpers";
import {
  settingsSchema,
  SETTINGS_DEFAULTS,
} from "../../server/admin/settings-schema";

export const scenarios = {
  owner: "Owner with a populated drive",
  admin: "Admin with a populated drive",
  member: "Member with a private drive",
  "signed-out": "Sign in with any sample account",
  setup: "Set up a new drive",
  onboarding: "Welcome a new member",
  invited: "New member with a temporary password",
  "admin-unavailable": "Admin pages unavailable",
  password: "Change a temporary password",
  empty: "Owner with an empty drive",
  error: "Failed jobs and unavailable admin health",
  busy: "Storage recovery and generating previews",
  update: "An update is available",
} as const;
export type Scenario = keyof typeof scenarios;
export const timestamp = "2026-10-29T12:00:00.000Z";
export const password = "preview-password";
export const memoryLimit = 16 * 1024 * 1024;
export const jobKinds = [
  "staging.cleanup",
  "trash.retention",
  "update.check",
  "restore.reconcile",
  "media.derivative.generate",
  "media.derivative.cleanup",
  "zip.archive.generate",
  "zip.archive.cleanup",
] as const;
type Job = InferResponseType<
  typeof api.api.views.admin.jobs.$get,
  200
>["initialProblems"][number];
export function sampleJob(
  kind: (typeof jobKinds)[number],
  id: string,
  status: Job["status"] = "succeeded",
): Job {
  return {
    id,
    kind,
    status,
    payloadJson: {},
    dedupeKey: null,
    runAt: timestamp,
    lockedAt: null,
    leaseExpiresAt: null,
    timeoutAt: null,
    cancelledAt: null,
    lockedBy: null,
    startedAt: timestamp,
    completedAt: status === "running" ? null : timestamp,
    attemptCount: 1,
    maxAttempts: 3,
    lastError: status === "failed" ? "Sample job could not finish." : null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
export type File = Plain<FileSummary> & {
  asset: string;
  thumbnailAsset?: string;
  favorite: boolean;
  pinned: boolean;
};
export type Folder = Plain<FolderSummary> & {
  favorite: boolean;
  pinned: boolean;
};
type UserRow = InferResponseType<
  typeof api.api.views.admin.users.$get,
  200
>["users"][number];
type Preferences = InferResponseType<
  typeof api.api.views.settings.$get,
  200
>["prefs"];
type User = UserRow & {
  storageId: string;
  createdAt: string;
  prefs: Preferences;
};

const firstRunByScenario: Partial<
  Record<Scenario, Exclude<FirstRunKind, "owner-setup">>
> = { invited: "member-password", onboarding: "member", password: "password" };
export function createState(scenario: Scenario = "owner") {
  const users: User[] = ["owner", "admin", "member"].map((role, index) => ({
    id: role,
    email: `${role}@staaash.test`,
    displayName: ["Alex Morgan", "Sam Rivera", "Mia Chen"][index]!,
    avatarUrl: null,
    role: role as User["role"],
    storageId: `sample-${role}`,
    storageLimitBytes: role === "owner" ? null : "5368709120",
    storageUsedBytes: "0",
    createdAt: timestamp,
    note: null,
    prefs: {
      theme: "system",
      timeZone: "UTC",
      showUpdateNotifications: true,
      showFolderPreviews: true,
      showPinsInSidebar: true,
      startPage: "home",
      defaultView: "grid",
      clockFormat: "24h",
    },
  }));
  const firstRun = firstRunByScenario[scenario] ?? null;
  const state = {
    scenario,
    userId: ["signed-out", "setup"].includes(scenario)
      ? (null as string | null)
      : ["member", "onboarding", "password", "invited"].includes(scenario)
        ? "member"
        : scenario === "admin"
          ? "admin"
          : "owner",
    firstRuns: new Map<string, Exclude<FirstRunKind, "owner-setup">>(
      firstRun ? [["member", firstRun]] : [],
    ),
    instanceName: "Sample Drive",
    users,
    passwords: new Map(users.map((user) => [user.id, password])),
    files: [] as File[],
    folders: [] as Folder[],
    shares: [] as Share[],
    uploads: new Map<string, Upload>(),
    blobs: new Map<string, Uint8Array<ArrayBuffer>>(),
    previewStates: new Map<
      string,
      import("../../lib/media-preview-status").MediaPreviewStatus
    >(),
    pinnedPreviews: new Set<string>(),
    unlocked: new Set<string>(),
    moves: new Map<
      string,
      import("../../server/files/types").BatchMoveOperationResponse
    >(),
    sessions: ["current", "phone"],
    settings: {
      ...plain(settingsSchema.parse(SETTINGS_DEFAULTS)),
      id: "singleton",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    recovering: scenario === "busy",
    jobs: jobKinds.map((kind, index) =>
      sampleJob(
        kind,
        `job-${index}`,
        scenario === "error" && index === 0
          ? "failed"
          : scenario === "busy" && index === 0
            ? "running"
            : "succeeded",
      ),
    ),
  };
  for (const user of users) seedDrive(state, user);
  return state;
}
function seedDrive(state: State, user: User) {
  const folder = (
    suffix: string,
    name: string,
    parent: string | null,
    color: string | null = null,
  ): Folder => ({
    id: `${user.id}-${suffix}`,
    name,
    parentId: parent,
    ownerUserId: user.id,
    ownerStorageId: user.storageId,
    isFilesRoot: parent === null,
    color,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    favorite: suffix === "photos",
    pinned: suffix === "photos",
    storageRevision: 1,
  });
  const root = folder("root", "Files", null);
  state.folders.push(root);
  if (state.scenario === "empty") return;
  state.folders.push(
    folder("photos", "Photos", root.id, "blue"),
    folder("documents", "Documents", root.id, "violet"),
    folder("empty", "Empty folder", root.id),
    folder("archive", "Photo archive", root.id, "amber"),
    folder("holiday", "Summer trip", `${user.id}-photos`, "green"),
  );
  sampleFiles.forEach((sample, index) => {
    const updatedAt = new Date(
      Date.parse(timestamp) - index * 36 * 60 * 60 * 1000,
    ).toISOString();
    state.files.push({
      id: `${user.id}-${sample.key}`,
      name: sample.name,
      mimeType: sample.mimeType,
      viewerKind: sample.viewerKind,
      asset: sample.asset,
      thumbnailAsset:
        sample.viewerKind === "video" ? "film-poster.jpg" : undefined,
      folderId: root.id,
      ownerUserId: user.id,
      ownerStorageId: user.storageId,
      sizeBytes: 0,
      deletedAt: null,
      createdAt: updatedAt,
      updatedAt,
      storageRevision: 1,
      favorite: sample.key === "coast",
      pinned: sample.key === "coast",
    });
  });
  const document = state.files.find((file) => file.id === `${user.id}-notes`)!;
  state.files.push({
    ...document,
    id: `${user.id}-expenses`,
    name: "Trip expenses.csv",
    mimeType: "text/csv",
    asset: "expenses.csv",
    folderId: `${user.id}-documents`,
    favorite: false,
    pinned: false,
  });
  seedPhotos(state, user);
  state.files.push({
    ...state.files.find((f) => f.id === `${user.id}-notes`)!,
    id: `${user.id}-trashed`,
    name: "Old notes.md",
    deletedAt: timestamp,
    favorite: false,
    pinned: false,
  });
  seedShares(state, user);
}
function seedPhotos(state: State, user: User) {
  const original = state.files.find((file) => file.id === `${user.id}-coast`)!;
  for (let index = 1; index <= 72; index++) {
    const sample = photoSamples[(index - 1) % photoSamples.length]!;
    const updatedAt = new Date(
      Date.parse(timestamp) - index * 24 * 60 * 60 * 1000,
    ).toISOString();
    state.files.push({
      ...original,
      id: `${user.id}-photo-${index}`,
      asset: sample.asset,
      name:
        index === 2
          ? "A very long photograph name to check how file cards wrap on a narrow screen.jpg"
          : `${sample.name.slice(0, -4)} - ${String(index).padStart(2, "0")}.jpg`,
      folderId: photoFolder(user.id, index),
      favorite: index === 1,
      pinned: false,
      createdAt: updatedAt,
      updatedAt,
    });
  }
}
function photoFolder(userId: string, index: number) {
  if (index <= 8) return `${userId}-photos`;
  return index === 9 ? `${userId}-holiday` : `${userId}-archive`;
}
function seedShares(state: State, user: User) {
  for (const [suffix, targetId, targetType, secret, inactive] of [
    ["photo", `${user.id}-coast`, "file", false, false],
    ["folder", `${user.id}-photos`, "folder", false, false],
    ["locked", `${user.id}-guide`, "file", true, false],
    ["locked-folder", `${user.id}-photos`, "folder", true, false],
    ["revoked", `${user.id}-notes`, "file", false, true],
    ["expired", `${user.id}-audio`, "file", false, false],
  ] as const)
    state.shares.push({
      id: `${user.id}-share-${suffix}`,
      token: `${user.id}-${suffix}`,
      ownerId: user.id,
      targetId,
      targetType,
      password: secret ? password : null,
      downloadDisabled: false,
      expiresAt:
        suffix === "expired"
          ? "2020-01-01T00:00:00.000Z"
          : "2036-10-29T12:00:00.000Z",
      revokedAt: inactive ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
}
export type State = ReturnType<typeof createState>;
export type PreviewEnv = { Variables: { state: State } };
export type Share = {
  id: string;
  token: string;
  ownerId: string;
  targetId: string;
  targetType: "file" | "folder";
  password: string | null;
  downloadDisabled: boolean;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Upload = {
  id: string;
  name: string;
  mimeType: string;
  folderId: string;
  total: number;
  chunks: Map<number, Uint8Array<ArrayBuffer>>;
  received: number;
};

export class PreviewError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 503,
    message: string,
    readonly code = "UI_PREVIEW_ERROR",
  ) {
    super(message);
  }
}
export const signedInUser = (state: State) => {
  const user = state.users.find((u) => u.id === state.userId);
  if (!user) throw new PreviewError(401, "Sign in to the sample drive.");
  return user;
};
export const currentFirstRun = (state: State) =>
  state.userId ? (state.firstRuns.get(state.userId) ?? null) : null;
export const requireUser = (state: State) => {
  const user = signedInUser(state);
  if (currentFirstRun(state))
    throw new PreviewError(401, "Sign in to the sample drive.");
  return user;
};
export const rootOf = (state: State, ownerId = requireUser(state).id) =>
  state.folders.find((f) => f.ownerUserId === ownerId && f.isFilesRoot)!;
export const folderOf = (state: State, id: string) => {
  const folder = state.folders.find((f) => f.id === id);
  if (!folder)
    throw new PreviewError(404, "Folder not found.", "FOLDER_NOT_FOUND");
  return folder;
};
export const fileOf = (state: State, id: string) => {
  const file = state.files.find((f) => f.id === id);
  if (!file) throw new PreviewError(404, "File not found.");
  return file;
};
export function within(
  state: State,
  folderId: string | null,
  ancestor: string,
): boolean {
  const visited = new Set<string>();
  while (folderId && !visited.has(folderId)) {
    if (folderId === ancestor) return true;
    visited.add(folderId);
    folderId = folderOf(state, folderId).parentId;
  }
  return false;
}
export function isDeleted(state: State, item: File | Folder): boolean {
  if (item.deletedAt) return true;
  let parent = "folderId" in item ? item.folderId : item.parentId;
  while (parent) {
    const folder = folderOf(state, parent);
    if (folder.deletedAt) return true;
    parent = folder.parentId;
  }
  return false;
}
export const pathOf = (state: State, folderId: string | null): string => {
  const names: string[] = [];
  let id = folderId;
  while (id) {
    const folder = folderOf(state, id);
    names.unshift(folder.name);
    id = folder.parentId;
  }
  return names.join(" / ");
};
export const publicFile = (file: File) => {
  const {
    asset: _asset,
    thumbnailAsset: _thumbnail,
    favorite: _favorite,
    pinned: _pinned,
    ...data
  } = file;
  return data;
};
export const publicFolder = (folder: Folder) => {
  const { favorite: _favorite, pinned: _pinned, ...data } = folder;
  return data;
};
export const sizeOf = (state: State, folderId: string) =>
  state.files
    .filter((f) => !isDeleted(state, f) && within(state, f.folderId, folderId))
    .reduce((sum, f) => sum + f.sizeBytes, 0);
export function recentItem(
  state: State,
  item: File | Folder,
): RecentClientItem {
  const common = {
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    isFavorite: item.favorite,
    at: item.updatedAt,
    lastAction: item.deletedAt ? ("trashed" as const) : ("opened" as const),
  };
  if ("mimeType" in item)
    return {
      ...common,
      kind: "file",
      href: `/files/view/${item.id}`,
      folderId: item.folderId,
      mimeType: item.mimeType,
      sizeBytes: item.sizeBytes,
      locationLabel: pathOf(state, item.folderId),
    };
  return {
    ...common,
    kind: "folder",
    href: `/files/f/${item.id}`,
    parentId: item.parentId,
    color: item.color,
    locationLabel: pathOf(state, item.parentId),
  };
}

export function previewStatus(state: State, id: string) {
  const status = state.previewStates.get(id);
  if (status) return status;
  if (state.scenario === "busy") return "processing";
  return state.scenario === "error" ? "failed" : "ready";
}

export function assertFolderReadable(state: State, id: string) {
  if (state.recovering && id.endsWith("-photos"))
    throw new PreviewError(
      503,
      "The sample folder is waiting for recovery.",
      "STORAGE_RECOVERY_REQUIRED",
    );
}
