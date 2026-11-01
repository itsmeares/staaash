import type { InferResponseType } from "hono/client";
import type { api } from "../../lib/api";
import { version } from "../../../../package.json";
import { folderBatchItems } from "../../src/workspace/files/folder-batch";
import {
  compareListItems,
  filterWorkspaceItems,
  sortWorkspaceItems,
  type WorkspaceItemFilterType,
} from "../../src/workspace/workspace-item-helpers";
import { z } from "zod";
import {
  type State,
  type Share,
  type File,
  PreviewError,
  folderOf,
  isDeleted,
  pathOf,
  publicFile,
  publicFolder,
  recentItem,
  requireUser,
  rootOf,
  sizeOf,
  timestamp,
  assertFolderReadable,
} from "./state";

const listQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  sort: z.string().default("name"),
  direction: z.enum(["asc", "desc"]).default("asc"),
  filter: z
    .enum([
      "all",
      "archive",
      "audio",
      "folder",
      "image",
      "pdf",
      "text",
      "video",
    ])
    .default("all"),
  find: z.string().default(""),
  grouped: z.boolean().optional(),
});
export function windowItems<
  T extends {
    id: string;
    kind: "file" | "folder";
    name: string;
    locationLabel: string;
    mimeType?: string;
    sizeBytes?: number;
    at?: string;
  },
>(items: T[], input: unknown = {}, all = false, foldersFirst = false) {
  const q = listQuery.parse(input);
  const matching = filterWorkspaceItems(
    items,
    q.filter as WorkspaceItemFilterType,
  ).filter((i) =>
    i.name.toLocaleLowerCase().includes(q.find.toLocaleLowerCase()),
  );
  const sorted = sortWorkspaceItems(
    matching,
    q.direction,
    compareListItems(q.sort, (item: T) => item.at ?? timestamp),
  );
  if (foldersFirst)
    sorted.sort(
      (left, right) =>
        Number(right.kind === "folder") - Number(left.kind === "folder"),
    );
  return {
    total: sorted.length,
    items: all ? sorted : sorted.slice(q.offset, q.offset + q.limit),
  };
}
export const ownedItems = (state: State, deleted = false) => {
  const user = requireUser(state);
  return [
    ...state.folders.filter((f) => !f.isFilesRoot),
    ...state.files,
  ].filter(
    (item) =>
      item.ownerUserId === user.id && (deleted || !isDeleted(state, item)),
  );
};
export function shareStatus(state: State, share: Share) {
  if (share.revokedAt) return "revoked" as const;
  if (Date.parse(share.expiresAt) <= Date.now()) return "expired" as const;
  const item = [...state.files, ...state.folders].find(
    (i) => i.id === share.targetId,
  );
  return !item || isDeleted(state, item)
    ? ("target-unavailable" as const)
    : ("active" as const);
}
export function shareView(state: State, share: Share, origin: string) {
  const item = [...state.files, ...state.folders].find(
    (i) => i.id === share.targetId,
  );
  if (!item) throw new PreviewError(404, "Shared item not found.");
  const base = {
    id: item.id,
    name: item.name,
    ownerUserId: item.ownerUserId,
    ownerStorageId: item.ownerStorageId,
    pathLabel: pathOf(
      state,
      "folderId" in item ? item.folderId : item.parentId,
    ),
    deletedAt: item.deletedAt,
  };
  return {
    id: share.id,
    createdByUserId: share.ownerId,
    targetType: share.targetType,
    fileId: share.targetType === "file" ? share.targetId : null,
    folderId: share.targetType === "folder" ? share.targetId : null,
    shareUrl: `${origin}/s/${share.token}`,
    hasPassword: share.password !== null,
    downloadDisabled: share.downloadDisabled,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    status: shareStatus(state, share),
    target:
      "mimeType" in item
        ? {
            ...base,
            targetType: "file" as const,
            folderId: item.folderId,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes,
          }
        : {
            ...base,
            targetType: "folder" as const,
            parentId: item.parentId,
            isFilesRoot: item.isFilesRoot,
          },
  };
}
export function filesView(
  state: State,
  origin: string,
  folderId = rootOf(state).id,
  query: unknown = {},
  all = false,
) {
  const user = requireUser(state);
  const folder = folderOf(state, folderId);
  if (folder.ownerUserId !== user.id || isDeleted(state, folder))
    throw new PreviewError(404, "Folder not found.", "FOLDER_NOT_FOUND");
  assertFolderReadable(state, folder.id);
  const folders = state.folders.filter(
    (f) => f.parentId === folder.id && !isDeleted(state, f),
  );
  const files = state.files.filter(
    (f) => f.folderId === folder.id && !isDeleted(state, f),
  );
  const items = [...folders, ...files];
  const page = windowItems(
    items.map((item) => recentItem(state, item)),
    query,
    all,
    true,
  );
  const shares = state.shares
    .filter((s) => s.ownerId === user.id && shareStatus(state, s) === "active")
    .map((s) => shareView(state, s, origin));
  const breadcrumbs = [];
  let parent = folder.parentId;
  while (parent) {
    const item = folderOf(state, parent);
    breadcrumbs.unshift({
      id: item.id,
      name: item.name,
      href: item.isFilesRoot ? "/files" : `/files/f/${item.id}`,
    });
    parent = item.parentId;
  }
  return {
    listing: {
      total: page.total,
      counts: { folders: folders.length, files: files.length },
      ownerUserId: user.id,
      currentFolder: publicFolder(folder),
      breadcrumbs,
      childFolders: page.items
        .filter((i) => i.kind === "folder")
        .map((i) => publicFolder(folders.find((f) => f.id === i.id)!)),
      files: page.items
        .filter((i) => i.kind === "file")
        .map((i) => publicFile(files.find((f) => f.id === i.id)!)),
      folderPreviews: Object.fromEntries(
        folders.map((f) => [
          f.id,
          state.files
            .filter(
              (file) =>
                withinFolder(state, file, f.id) && file.viewerKind === "image",
            )
            .slice(0, 2)
            .map((file) => file.id),
        ]),
      ),
    },
    shareLookup: {
      currentFolderShare: shares.find((s) => s.folderId === folder.id) ?? null,
      sharesByFolderId: Object.fromEntries(
        shares.filter((s) => s.folderId).map((s) => [s.folderId!, s]),
      ),
      sharesByFileId: Object.fromEntries(
        shares.filter((s) => s.fileId).map((s) => [s.fileId!, s]),
      ),
    },
    showFolderPreviews: user.prefs.showFolderPreviews,
    favoriteFileIds: files.filter((f) => f.favorite).map((f) => f.id),
    favoriteFolderIds: folders.filter((f) => f.favorite).map((f) => f.id),
    folderSizeBytes: sizeOf(state, folder.id),
  } satisfies InferResponseType<typeof api.api.views.files.$get, 200>;
}
const withinFolder = (state: State, file: File, id: string) =>
  file.folderId === id && !isDeleted(state, file);
export const folderBatch = (
  state: State,
  origin: string,
  folderId: string,
  query: unknown,
  all: boolean,
) => folderBatchItems(filesView(state, origin, folderId, query, all));
export function viewerWindow(state: State, folderId: string, offset = 0) {
  const user = requireUser(state);
  const folder = folderOf(state, folderId);
  if (folder.ownerUserId !== user.id || isDeleted(state, folder))
    throw new PreviewError(404, "Folder not found.", "FOLDER_NOT_FOUND");
  const all = state.files.filter(
    (f) => f.folderId === folderId && f.viewerKind && !isDeleted(state, f),
  );
  return {
    files: all.slice(offset, offset + 100).map(publicFile),
    start: offset,
    total: all.length,
  };
}
function storageKind(kind: File["viewerKind"]) {
  if (kind === "image") return "photos";
  if (kind === "video") return "videos";
  if (kind === "audio") return "audio";
  return "documents";
}
export function storageView(state: State, ownerId: string) {
  const user = state.users.find((u) => u.id === ownerId)!;
  const files = state.files.filter((f) => f.ownerUserId === ownerId);
  const byKind = { photos: 0, videos: 0, audio: 0, documents: 0, trash: 0 };
  for (const file of files) {
    const kind = isDeleted(state, file)
      ? "trash"
      : storageKind(file.viewerKind);
    byKind[kind] += file.sizeBytes;
  }
  const shares = state.shares.filter(
    (s) => s.ownerId === ownerId && shareStatus(state, s) === "active",
  );
  return {
    usedBytes: files.reduce((sum, f) => sum + f.sizeBytes, 0),
    limitBytes: user.storageLimitBytes ? Number(user.storageLimitBytes) : null,
    byKind,
    trashItems: files.filter((f) => isDeleted(state, f)).length,
    activeShares: shares.length,
    passwordShares: shares.filter((s) => s.password).length,
  };
}
export const devices = (state: State) =>
  state.sessions.map((id) => ({
    id,
    device: id === "current" ? "Chrome on Linux" : "Safari on iPhone",
    current: id === "current",
    ipAddress: "192.0.2.10",
    lastSeenAt: timestamp,
    createdAt: timestamp,
    kind: "browser" as const,
  }));
export function shellView(
  state: State,
  updates: InferResponseType<
    typeof api.api.views.shell.$get,
    200
  >["updateState"],
) {
  const user = requireUser(state);
  const pinned = ownedItems(state)
    .filter((i) => i.pinned)
    .map((item) => ({
      id: item.id,
      kind: "mimeType" in item ? ("file" as const) : ("folder" as const),
      name: item.name,
      href:
        "mimeType" in item ? `/files/view/${item.id}` : `/files/f/${item.id}`,
      ...("mimeType" in item
        ? { mimeType: item.mimeType }
        : { color: item.color ?? null }),
    }));
  return {
    info: {
      instanceName: state.instanceName,
      pins: pinned,
      isOwner: user.role === "owner",
      canAdmin: user.role !== "member",
      appVersion: version,
      usedBytes: String(storageView(state, user.id).usedBytes),
      limitBytes: user.storageLimitBytes,
      diskUsedBytes: "53687091200",
      diskCapacityBytes: "536870912000",
    },
    updateState: user.role === "owner" ? updates : null,
    nodeVersion: process.version,
    person: {
      label: user.displayName ?? user.email,
      email: user.email,
      initials: (user.displayName ?? user.email)
        .split(" ")
        .map((n) => n[0])
        .join(""),
      avatarUrl: user.avatarUrl,
      defaultView: user.prefs.defaultView,
      notify: user.prefs.showUpdateNotifications,
      timeZone: user.prefs.timeZone,
      clock: user.prefs.clockFormat,
    },
  } satisfies InferResponseType<typeof api.api.views.shell.$get, 200>;
}
export function homeView(state: State, origin: string) {
  const items = ownedItems(state);
  const recent = items.slice(0, 8).map((i) => recentItem(state, i));
  return {
    hasFavorites: items.some((i) => i.favorite),
    pinned: items.filter((i) => i.pinned).map((i) => recentItem(state, i)),
    recent,
    pickUp: state.files
      .filter((f) => f.ownerUserId === state.userId && !isDeleted(state, f))
      .slice(0, 6)
      .map((f) => recentItem(state, f)),
    shares: state.shares
      .filter(
        (s) => s.ownerId === state.userId && shareStatus(state, s) === "active",
      )
      .map((s) => {
        const view = shareView(state, s, origin);
        return {
          id: s.id,
          name: view.target.name,
          kind: s.targetType,
          mimeType:
            view.target.targetType === "file"
              ? view.target.mimeType
              : undefined,
          downloadDisabled: s.downloadDisabled,
          hasPassword: !!s.password,
          expiresAt: s.expiresAt,
        };
      }),
  } satisfies InferResponseType<typeof api.api.views.home.$get, 200>;
}
export function settingsView(state: State) {
  const user = requireUser(state);
  return {
    isOwner: user.role === "owner",
    prefs: user.prefs,
    sessions: devices(state),
    storage: storageView(state, user.id),
    profile: {
      name: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role:
        user.role === "owner"
          ? "Owner"
          : user.role === "admin"
            ? "Admin"
            : "Member",
    },
  } satisfies InferResponseType<typeof api.api.views.settings.$get, 200>;
}
