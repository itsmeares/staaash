import { createHash } from "node:crypto";
import path from "node:path";

import { resolveUploadMimeType } from "@staaash/config/media-types";
import { normalizeTimeZone } from "@staaash/config/time-zone";

import { Prisma, getPrisma } from "./client";
import {
  assertStorageFilesystemSupported,
  captureStorageNode,
  executeClaimedStorageMutation,
  inspectStorageNode,
  renameCanResume,
  recoverStorageMutationCleanup,
  storageKeyIsFree,
  type CapturedStorageNode,
  type StorageNodeReport,
} from "./storage-mutation-executor";
import {
  applyStorageMutationIntentMetadata,
  claimStorageMutation,
  findStorageMutation,
  hashStorageMutationRequest,
  prepareStorageMutation,
  STORAGE_MUTATION_CHUNK_SIZE,
  storagePathResourceKey,
  storageReviewOutcomeOf,
  USER_STORAGE_MUTATION_KINDS,
  type StorageMetadataOperation,
  type StorageMutationEntityInput,
  type StorageMutationRecord,
  type StorageMutationStepInput,
} from "./storage-mutations";
import { runStorageTransaction } from "./storage-transactions";

/*
 * A change that stopped for review ("recovery_required") gets a way out here.
 * Every choice runs through the journal: a separate keep change moves anything
 * in the way to an unused name and adds it to the person's drive, then the
 * stopped change is rewritten and resumes. Nothing is deleted except empty
 * folders, and execution checks every byte again right before it acts.
 */

export type StorageReviewChoice =
  | "finish"
  | "keep"
  | "undo"
  | "remove"
  | "retry";

export type StorageReviewGroup =
  /** The item is in both places and neither matches what was captured. */
  | "two_copies"
  /** The item is in neither place. */
  | "no_copy"
  /** The item is in one place but its bytes changed. */
  | "changed"
  /** Something sits where the change needs to write; it has one right answer. */
  | "in_the_way"
  /** A shortcut, special file or unsafe path; only the server can fix it. */
  | "unsafe"
  /** The saved plan itself is wrong. */
  | "broken"
  /** Another stopped change has to be fixed first. */
  | "waiting"
  /** Nothing on disk stops it any more. */
  | "clear";

export type StorageReviewPlaceState =
  | "matches"
  | "changed"
  | "missing"
  | "empty"
  | "unsafe";

export type StorageReviewPlace = {
  role: "new" | "old" | "leftover";
  label: string;
  state: StorageReviewPlaceState;
  isFolder: boolean;
  sizeBytes: string | null;
  fileCount: number | null;
  expectedSizeBytes: string | null;
  modifiedAt: string | null;
};

export type StorageReviewChoiceView = {
  id: StorageReviewChoice;
  /** The name a kept copy gets, when this choice keeps one. */
  copyName?: string;
  /** How many copies it keeps, when more than one. */
  copyCount?: number;
};

export type StorageReviewInspection = {
  checkedAt: string;
  /** A digest of what each place held; a choice names the one it answers. */
  seen: string;
  stepId: string | null;
  group: StorageReviewGroup;
  itemName: string | null;
  isFolder: boolean;
  places: StorageReviewPlace[];
  choices: StorageReviewChoiceView[];
  auto: StorageReviewChoice | null;
  unsafeReason?: string;
  waitingFor?: string;
  /** A copy to keep has more files than one change can add yet. */
  tooBig?: boolean;
  error?: string;
};

export type StorageReviewKeptItem = {
  itemId: string;
  kind: "file" | "folder";
  name: string;
  keepMutationId: string;
};

export type StorageReviewFix = {
  choice: StorageReviewChoice;
  automatic: boolean;
  byUserId: string | null;
  at: string;
  group: StorageReviewGroup;
  guard: string;
  kept: StorageReviewKeptItem[];
  removedEmptyFolders: number;
};

export type StorageReviewRecord = {
  inspection?: StorageReviewInspection;
  fixes: StorageReviewFix[];
};

const MOVE_KINDS = new Set([
  "file_rename",
  "file_move",
  "file_trash",
  "file_restore",
  "folder_rename",
  "folder_move",
  "folder_trash",
  "folder_restore",
]);
const UPLOAD_KINDS = new Set(["upload_create", "upload_replace"]);
// Only deletes can skip a missing item. A publish without its file must not
// commit ready metadata, so it waits for Check again.
const SKIPPABLE_KINDS = new Set([
  "file_purge",
  "folder_purge",
  "derivative_purge",
  "archive_purge",
]);
const GENERATED_KINDS = new Set([
  "derivative_publish",
  "derivative_purge",
  "archive_publish",
  "archive_purge",
]);
const PARENT_KINDS = new Set(["batch_move", "clear_trash", "trash_retention"]);
const CLEANUP_ACTIONS = new Set([
  "delete_file",
  "delete_tree",
  "remove_empty_directory",
]);
const KEEP_KIND = "storage_review_keep";
const keepKeyPrefix = (mutationId: string) =>
  `storage-review-keep:${mutationId}:`;

type Mutation = StorageMutationRecord;
type Step = Mutation["steps"][number];

export const readStorageReviewRecord = (
  value: unknown,
): StorageReviewRecord => {
  const record = value as Partial<StorageReviewRecord> | null;
  return {
    ...(record?.inspection ? { inspection: record.inspection } : {}),
    fixes: Array.isArray(record?.fixes) ? record.fixes : [],
  };
};

const stableId = (value: string) => {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
};

const AREA_LABELS: Record<string, string> = {
  files: "Files",
  ".trash": "Trash",
  tmp: "Staging",
  derivatives: "Generated",
  archives: "Generated",
};

/** A path the owner may see: the area and the item's own name, not its folders. */
export const storageReviewPlaceLabel = (storageKey: string) => {
  const parts = storageKey.split("/");
  const area = AREA_LABELS[parts[0] ?? ""] ?? parts[0] ?? "";
  const inside = ["files", ".trash"].includes(parts[0] ?? "")
    ? parts.slice(2)
    : parts.slice(1);
  if (inside.length === 0) return area;
  return inside.length === 1
    ? `${area} / ${inside[0]}`
    : `${area} / … / ${inside.at(-1)}`;
};

const TRASH_NAME =
  /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}(?:\.\d+)? UTC - (.+) \(\d+\)$/;
const displayNameOf = (storageKey: string) => {
  const name = path.posix.basename(storageKey);
  return TRASH_NAME.exec(name)?.[1] ?? name;
};

const takeUtf8Bytes = (value: string, maxBytes: number) => {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character) > maxBytes) break;
    result += character;
  }
  return result;
};

/** Like the desktop app's conflict copies: "report (recovered, 2026-11-25 14-09).pdf". */
export const recoveredCopyName = (
  name: string,
  stamp: string,
  attempt: number,
  isFile: boolean,
) => {
  const dot = isFile ? name.lastIndexOf(".") : -1;
  let stem = dot > 0 ? name.slice(0, dot) : name;
  let extension = dot > 0 ? name.slice(dot) : "";
  const suffix = ` (recovered, ${stamp}${attempt > 1 ? ` ${attempt}` : ""})`;
  if (Buffer.byteLength(suffix + extension) >= 200) {
    stem = name;
    extension = "";
  }
  return `${takeUtf8Bytes(stem, 255 - Buffer.byteLength(suffix + extension))}${suffix}${extension}`;
};

const copyStamp = async (ownerUserId: string, at: Date) => {
  const [preference, settings] = await Promise.all([
    getPrisma().userPreference.findUnique({
      where: { userId: ownerUserId },
      select: { timeZone: true },
    }),
    getPrisma().systemSettings.findUnique({
      where: { id: "singleton" },
      select: { timeZone: true },
    }),
  ]);
  const preferred = preference?.timeZone ?? "";
  const timeZone =
    normalizeTimeZone(preferred) === preferred
      ? preferred
      : normalizeTimeZone(settings?.timeZone);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}-${parts.minute}`;
};

type DriveFolder = { id: string; storageRevision: number };

const findDriveFolder = async (
  ownerUserId: string,
  storageId: string,
  folderKey: string,
): Promise<DriveFolder | null> => {
  const rootKey = `files/${storageId}`;
  if (folderKey !== rootKey && !folderKey.startsWith(`${rootKey}/`)) {
    return null;
  }
  let folder = await getPrisma().folder.findFirst({
    where: { ownerUserId, isFilesRoot: true, deletedAt: null },
    select: { id: true, storageRevision: true },
  });
  const names =
    folderKey === rootKey ? [] : folderKey.slice(rootKey.length + 1).split("/");
  for (const name of names) {
    if (!folder) return null;
    folder = await getPrisma().folder.findFirst({
      where: { ownerUserId, parentId: folder.id, name, deletedAt: null },
      select: { id: true, storageRevision: true },
    });
  }
  return folder;
};

const nameTakenInFolder = async (
  folderId: string,
  name: string,
  ignoresCase: boolean,
) => {
  const match = ignoresCase
    ? { equals: name, mode: "insensitive" as const }
    : name;
  const [file, folder] = await Promise.all([
    getPrisma().file.findFirst({
      where: { folderId, originalName: match, deletedAt: null },
      select: { id: true },
    }),
    getPrisma().folder.findFirst({
      where: { parentId: folderId, name: match, deletedAt: null },
      select: { id: true },
    }),
  ]);
  return Boolean(file || folder);
};

// Linux PATH_MAX is 4096 bytes including the terminating NUL.
const MAX_PATH_BYTES = 4095;

type CopyPlace = {
  key: string;
  name: string;
  folder: DriveFolder | null;
};

type ReviewContext = {
  mutation: Mutation;
  filesRoot: string;
  storageId: string;
  ignoresCase: boolean;
  stamp: string;
  takenKeys: Set<string>;
};

const isInDrive = (context: ReviewContext, storageKey: string) =>
  storageKey.startsWith(`files/${context.storageId}/`);

/**
 * Next to where the copy was found when that is in the person's drive, else
 * next to the item's other place, else at the top of the drive. Generated
 * output stays where it was, renamed, since it is not the person's file.
 */
const pickCopyPlace = async (
  context: ReviewContext,
  foundKey: string,
  otherKey: string | null,
  name: string,
  isFile: boolean,
): Promise<CopyPlace | null> => {
  const generated = GENERATED_KINDS.has(context.mutation.kind);
  for (const parentKey of copyParents(context, foundKey, otherKey)) {
    const folder = generated
      ? null
      : await findDriveFolder(
          context.mutation.ownerUserId,
          context.storageId,
          parentKey,
        );
    if (!folder && !generated) continue;
    const place = await freeCopyPlace(context, parentKey, folder, name, isFile);
    if (place) return place;
  }
  return null;
};

const copyParents = (
  context: ReviewContext,
  foundKey: string,
  otherKey: string | null,
) => {
  if (GENERATED_KINDS.has(context.mutation.kind)) {
    return [path.posix.dirname(foundKey)];
  }
  const inDrive = [foundKey, otherKey].filter((key): key is string =>
    Boolean(key && isInDrive(context, key)),
  );
  return [
    ...new Set([
      ...inDrive.map((key) => path.posix.dirname(key)),
      `files/${context.storageId}`,
    ]),
  ];
};

const copyNameTaken = async (
  context: ReviewContext,
  key: string,
  folder: DriveFolder | null,
  copyName: string,
) =>
  context.takenKeys.has(key.toLowerCase()) ||
  !(await storageKeyIsFree(context.filesRoot, key)) ||
  Boolean(
    folder &&
    (await nameTakenInFolder(folder.id, copyName, context.ignoresCase)),
  );

const freeCopyPlace = async (
  context: ReviewContext,
  parentKey: string,
  folder: DriveFolder | null,
  name: string,
  isFile: boolean,
): Promise<CopyPlace | null> => {
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const copyName = recoveredCopyName(name, context.stamp, attempt, isFile);
    const key = `${parentKey}/${copyName}`;
    const fullPath = path.resolve(context.filesRoot, key);
    if (Buffer.byteLength(fullPath) > MAX_PATH_BYTES) return null;
    if (await copyNameTaken(context, key, folder, copyName)) continue;
    context.takenKeys.add(key.toLowerCase());
    return { key, name: copyName, folder };
  }
  return null;
};

type Obstacle = {
  key: string;
  drop: boolean;
  isFolder: boolean;
  fileCount: number;
  place: CopyPlace | null;
};

type Rewrite =
  | { type: "resume" }
  | { type: "refresh"; itemKey: string }
  | { type: "undo"; itemKey: string | null; refresh: boolean }
  | { type: "remove" }
  | { type: "drop_item" }
  | { type: "skip" };

type ReviewPlan = { obstacles: Obstacle[]; rewrite: Rewrite };

type Inspected = {
  inspection: StorageReviewInspection;
  plans: Partial<Record<StorageReviewChoice, ReviewPlan>>;
  step: Step | null;
  resetStepIds: string[];
};

const forwardSteps = (mutation: Mutation) =>
  mutation.steps.filter((step) => !CLEANUP_ACTIONS.has(step.action));
const cleanupSteps = (mutation: Mutation) =>
  mutation.steps.filter((step) => CLEANUP_ACTIONS.has(step.action));

const existsAt = async (context: ReviewContext, storageKey: string | null) =>
  Boolean(storageKey) &&
  !(await storageKeyIsFree(context.filesRoot, storageKey!).catch(() => true));

/**
 * The first forward step whose bytes are not where the journal says, and every
 * applied step a rollback already reversed. Those go back to pending, so a
 * resumed change never commits metadata for bytes that moved back.
 */
const findForwardStop = async (context: ReviewContext) => {
  let stop: Step | null = null;
  const reset: string[] = [];
  for (const step of forwardSteps(context.mutation)) {
    if (step.status !== "applied") {
      stop ??= step;
      continue;
    }
    const moved = step.action === "rename" || step.action === "set_aside";
    if (!moved && step.action !== "mkdir") continue;
    if (await existsAt(context, step.targetKey)) continue;
    reset.push(step.id);
    stop ??= step;
  }
  return { stop, reset };
};

const canUndo = (mutation: Mutation) =>
  USER_STORAGE_MUTATION_KINDS.has(mutation.kind) &&
  !UPLOAD_KINDS.has(mutation.kind) &&
  mutation.parentId === null &&
  storageReviewOutcomeOf(mutation.intentJson) !== "undone" &&
  !mutation.metadataCommittedAt &&
  mutation.metadataOperationsApplied === 0;

// The device and inode tell a replaced file from one edited in place. They
// only go into the digest, never to the page.
type SeenPlace = StorageReviewPlace & { identity?: string };

const placeOf = (
  role: StorageReviewPlace["role"],
  storageKey: string,
  report: StorageNodeReport,
  state: StorageReviewPlaceState,
  step: Step | null,
): SeenPlace => ({
  ...("identity" in report ? { identity: report.identity } : {}),
  role,
  label: storageReviewPlaceLabel(storageKey),
  state,
  isFolder:
    report.state === "directory" || step?.expectedNodeType === "directory",
  sizeBytes: "sizeBytes" in report ? String(report.sizeBytes) : null,
  fileCount: "fileCount" in report ? report.fileCount : null,
  expectedSizeBytes:
    step?.expectedSizeBytes != null ? String(step.expectedSizeBytes) : null,
  modifiedAt: "modifiedAt" in report ? report.modifiedAt.toISOString() : null,
});

const stateOf = (
  report: StorageNodeReport,
  otherHasIt: boolean,
): StorageReviewPlaceState => {
  if (report.state === "missing") return otherHasIt ? "empty" : "missing";
  if (report.state === "unsafe") return "unsafe";
  return report.matches === false ? "changed" : "matches";
};

const present = (report: StorageNodeReport) =>
  report.state === "file" || report.state === "directory";

type ItemEntity = Mutation["entities"][number];

const jsonOf = (value: unknown) =>
  (value && typeof value === "object" ? value : {}) as Record<string, unknown>;

/** The entity a rename step moves: the file at its source, or the top folder. */
const itemEntityOf = (mutation: Mutation, step: Step) => {
  if (step.expectedNodeType === "file") {
    return mutation.entities.find(
      (entity) =>
        entity.entityType === "file" &&
        jsonOf(entity.beforeJson).storageKey === step.sourceKey,
    );
  }
  // Guard entities (same revision before and after) only lock a folder, such
  // as the destination; they are never the item that moves.
  const folders = mutation.entities.filter(
    (entity) =>
      entity.entityType === "folder" &&
      entity.preRevision !== entity.postRevision,
  );
  const ids = new Set(folders.map((entity) => entity.entityId));
  return folders.find((entity) => {
    const parentId = jsonOf(entity.beforeJson).parentId;
    return typeof parentId !== "string" || !ids.has(parentId);
  });
};

const operationsOf = (mutation: Mutation) =>
  ((mutation.intentJson as { metadataOperations?: unknown })
    ?.metadataOperations ?? []) as StorageMetadataOperation[];

const createdFileOpOf = (mutation: Mutation, storageKey: string | null) =>
  operationsOf(mutation).find(
    (operation) =>
      operation.action === "create_file" &&
      operation.data.storageKey === storageKey,
  ) as Extract<StorageMetadataOperation, { action: "create_file" }> | undefined;

const itemNameOf = (mutation: Mutation, step: Step) => {
  const created = createdFileOpOf(mutation, step.targetKey);
  if (created) return created.data.originalName;
  const entity = itemEntityOf(mutation, step);
  const name = jsonOf(entity?.beforeJson).name;
  if (typeof name === "string" && name) return name;
  return displayNameOf(step.targetKey ?? step.sourceKey ?? "");
};

const obstacleFor = async (
  context: ReviewContext,
  key: string,
  report: StorageNodeReport,
  otherKey: string | null,
  name: string,
): Promise<Obstacle> => {
  const isFolder = report.state === "directory";
  const drop = isFolder && "onlyFolders" in report && report.onlyFolders;
  return {
    key,
    drop,
    isFolder,
    fileCount: "fileCount" in report ? report.fileCount : 0,
    place: drop
      ? null
      : await pickCopyPlace(context, key, otherKey, name, !isFolder),
  };
};

const choiceView = (
  id: StorageReviewChoice,
  plan: ReviewPlan,
): StorageReviewChoiceView => {
  const kept = plan.obstacles.filter((obstacle) => obstacle.place);
  return {
    id,
    ...(kept.length === 1 ? { copyName: kept[0]!.place!.name } : {}),
    ...(kept.length > 1 ? { copyCount: kept.length } : {}),
  };
};

const tooBigToKeep = (plan: ReviewPlan) =>
  plan.obstacles.some(
    (obstacle) =>
      !obstacle.drop &&
      (!obstacle.place || obstacle.fileCount >= STORAGE_MUTATION_CHUNK_SIZE),
  );

type InspectionBase = Omit<
  StorageReviewInspection,
  "checkedAt" | "seen" | "choices" | "auto" | "places"
> & {
  auto?: StorageReviewChoice | null;
  places: SeenPlace[];
};

const finishInspection = (
  context: Pick<ReviewContext, "mutation">,
  base: InspectionBase,
  plans: Partial<Record<StorageReviewChoice, ReviewPlan>>,
): Pick<Inspected, "inspection" | "plans"> => {
  const usable: Partial<Record<StorageReviewChoice, ReviewPlan>> = {};
  let tooBig = false;
  for (const [id, plan] of Object.entries(plans) as Array<
    [StorageReviewChoice, ReviewPlan]
  >) {
    if (tooBigToKeep(plan)) tooBig = true;
    else usable[id] = plan;
  }
  // Resuming past something in the way could delete it (a quarantine cleanup
  // removes its whole folder), so Check again only re-checks then.
  if (base.group !== "in_the_way") {
    usable.retry = { obstacles: [], rewrite: { type: "resume" } };
  }
  const auto =
    base.auto && usable[base.auto] && context.mutation.kind !== KEEP_KIND
      ? base.auto
      : null;
  return {
    inspection: {
      ...base,
      places: base.places.map(({ identity: _identity, ...place }) => place),
      checkedAt: new Date().toISOString(),
      seen: createHash("sha256")
        .update(JSON.stringify([base.stepId, base.group, base.places]))
        .digest("base64url"),
      auto,
      ...(tooBig ? { tooBig } : {}),
      choices: (Object.keys(usable) as StorageReviewChoice[]).map((id) =>
        choiceView(id, usable[id]!),
      ),
    },
    plans: usable,
  };
};

// fallow-ignore-next-line complexity
const inspectRename = async (context: ReviewContext, step: Step) => {
  const { mutation } = context;
  const name = itemNameOf(mutation, step);
  const isFolder = step.expectedNodeType === "directory";
  const base = { stepId: step.id, itemName: name, isFolder };
  if (!step.sourceKey || !step.targetKey) {
    return finishInspection(
      context,
      { ...base, group: "broken", places: [] },
      {},
    );
  }
  const [source, target] = await Promise.all([
    inspectStorageNode(context.filesRoot, step.sourceKey, step),
    inspectStorageNode(context.filesRoot, step.targetKey, step),
  ]);
  const places = [
    placeOf(
      "new",
      step.targetKey,
      target,
      stateOf(target, present(source)),
      step,
    ),
    placeOf(
      "old",
      step.sourceKey,
      source,
      stateOf(source, present(target)),
      step,
    ),
  ];
  const withPlaces = { ...base, places };
  if (source.state === "unsafe" || target.state === "unsafe") {
    return finishInspection(
      context,
      {
        ...withPlaces,
        group: "unsafe",
        unsafeReason:
          source.state === "unsafe"
            ? source.reason
            : (target as { reason: string }).reason,
      },
      {},
    );
  }
  if (!step.expectedChecksum && !step.treeManifestDigest) {
    return finishInspection(context, { ...withPlaces, group: "broken" }, {});
  }
  const undoable = canUndo(mutation);
  if (!present(source) && !present(target)) {
    return finishInspection(
      context,
      { ...withPlaces, group: "no_copy" },
      noCopyPlans(mutation),
    );
  }
  // One entry under both names: a set-aside stopped between link and unlink,
  // or a case-only rename. Two hard links to one file are neither.
  if (
    "identity" in source &&
    "identity" in target &&
    source.identity === target.identity &&
    (step.action === "set_aside"
      ? source.state === "file"
      : await renameCanResume(context.filesRoot, step))
  ) {
    return clearInspection(context, withPlaces);
  }
  if (!present(source)) {
    if (target.state !== "missing" && "matches" in target && target.matches) {
      return clearInspection(context, withPlaces);
    }
    return finishInspection(
      context,
      { ...withPlaces, group: "changed" },
      {
        keep: {
          obstacles: [],
          rewrite: { type: "refresh", itemKey: step.targetKey },
        },
        ...(undoable
          ? {
              undo: {
                obstacles: [],
                rewrite: {
                  type: "undo",
                  itemKey: step.targetKey,
                  refresh: true,
                },
              },
            }
          : {}),
      },
    );
  }
  if (!present(target)) {
    if ("matches" in source && source.matches) {
      return clearInspection(context, withPlaces);
    }
    return finishInspection(
      context,
      { ...withPlaces, group: "changed" },
      {
        keep: {
          obstacles: [],
          rewrite: { type: "refresh", itemKey: step.sourceKey },
        },
        ...(undoable
          ? {
              undo: {
                obstacles: [],
                rewrite: {
                  type: "undo",
                  itemKey: step.sourceKey,
                  refresh: true,
                },
              },
            }
          : {}),
      },
    );
  }
  const sourceMatches = "matches" in source && source.matches === true;
  const targetMatches = "matches" in target && target.matches === true;
  if (targetMatches || sourceMatches) {
    // The side that matches is the item; the other is in the way.
    const [itemKey, otherKey, otherReport] = targetMatches
      ? [step.targetKey, step.sourceKey, source]
      : [step.sourceKey, step.targetKey, target];
    return finishInspection(
      context,
      { ...withPlaces, group: "in_the_way", auto: "finish" },
      {
        finish: {
          obstacles: [
            await obstacleFor(context, otherKey, otherReport, itemKey, name),
          ],
          rewrite: { type: "resume" },
        },
      },
    );
  }
  return finishInspection(
    context,
    { ...withPlaces, group: "two_copies" },
    {
      finish: {
        obstacles: [
          await obstacleFor(
            context,
            step.sourceKey,
            source,
            step.targetKey,
            name,
          ),
        ],
        rewrite: { type: "refresh", itemKey: step.targetKey },
      },
      ...(undoable
        ? {
            undo: {
              obstacles: [
                await obstacleFor(
                  context,
                  step.targetKey,
                  target,
                  step.sourceKey,
                  name,
                ),
              ],
              rewrite: { type: "undo", itemKey: step.sourceKey, refresh: true },
            },
          }
        : {}),
    },
  );
};

const clearInspection = (
  context: ReviewContext,
  base: Omit<InspectionBase, "group" | "auto">,
) => finishInspection(context, { ...base, group: "clear", auto: "retry" }, {});

const noCopyPlans = (
  mutation: Mutation,
): Partial<Record<StorageReviewChoice, ReviewPlan>> => {
  if (SKIPPABLE_KINDS.has(mutation.kind)) {
    return { finish: { obstacles: [], rewrite: { type: "skip" } } };
  }
  if (MOVE_KINDS.has(mutation.kind)) {
    return { remove: { obstacles: [], rewrite: { type: "remove" } } };
  }
  if (mutation.kind === "upload_create") {
    const files = forwardSteps(mutation).length;
    return {
      remove: {
        obstacles: [],
        rewrite:
          files > 1
            ? { type: "drop_item" }
            : { type: "undo", itemKey: null, refresh: false },
      },
    };
  }
  if (mutation.kind === "upload_replace") {
    return {
      remove: {
        obstacles: [],
        rewrite: { type: "undo", itemKey: null, refresh: false },
      },
    };
  }
  return {};
};

/** A step that writes a new node: something already there is in the way. */
const inspectTargetOnly = async (
  context: ReviewContext,
  step: Step,
  role: StorageReviewPlace["role"],
  otherKey: string | null,
) => {
  const key = step.targetKey ?? step.sourceKey;
  // Bytes in a quarantine or staging path are named after where they came from.
  const name = displayNameOf(otherKey ?? key ?? "");
  const base = {
    stepId: step.id,
    itemName: key ? name : null,
    isFolder: step.expectedNodeType === "directory",
  };
  if (!key) {
    return finishInspection(
      context,
      { ...base, group: "broken", places: [] },
      {},
    );
  }
  const report = await inspectStorageNode(
    context.filesRoot,
    key,
    step.expectedChecksum || step.treeManifestDigest ? step : null,
  );
  const places = [placeOf(role, key, report, stateOf(report, false), step)];
  if (report.state === "missing") {
    return clearInspection(context, { ...base, places });
  }
  if (report.state === "unsafe") {
    return finishInspection(
      context,
      { ...base, places, group: "unsafe", unsafeReason: report.reason },
      {},
    );
  }
  if (report.matches === true) {
    return clearInspection(context, { ...base, places });
  }
  return finishInspection(
    context,
    { ...base, places, group: "in_the_way", auto: "finish" },
    {
      finish: {
        obstacles: [await obstacleFor(context, key, report, otherKey, name)],
        rewrite: { type: "resume" },
      },
    },
  );
};

// A cleanup key a forward rename filled is that item's old place; a copy
// found there belongs next to where the item came from.
const originOf = (mutation: Mutation, storageKey: string) =>
  forwardSteps(mutation).find(
    (step) => step.action === "rename" && step.targetKey === storageKey,
  )?.sourceKey ?? null;

const inspectLegacyResidue = async (context: ReviewContext) => {
  const obstacles: Obstacle[] = [];
  const places: SeenPlace[] = [];
  for (const step of cleanupSteps(context.mutation)) {
    if (step.status === "applied" || !step.targetKey) continue;
    const report = await inspectStorageNode(context.filesRoot, step.targetKey);
    if (report.state === "missing") continue;
    if (places.length < 10) {
      places.push(placeOf("leftover", step.targetKey, report, "changed", step));
    }
    if (report.state === "unsafe") {
      return finishInspection(
        context,
        {
          stepId: step.id,
          itemName: displayNameOf(step.targetKey),
          isFolder: false,
          places,
          group: "unsafe",
          unsafeReason: report.reason,
        },
        {},
      );
    }
    obstacles.push(
      await obstacleFor(
        context,
        step.targetKey,
        report,
        null,
        displayNameOf(step.targetKey),
      ),
    );
  }
  const base = {
    stepId: null,
    itemName: places[0] ? displayNameOf(places[0].label) : null,
    isFolder: false,
    places,
  };
  if (obstacles.length === 0) return clearInspection(context, base);
  return finishInspection(
    context,
    { ...base, group: "in_the_way", auto: "finish" },
    { finish: { obstacles, rewrite: { type: "resume" } } },
  );
};

const inspectParent = async (context: ReviewContext) => {
  const child = await getPrisma().storageMutation.findFirst({
    where: { parentId: context.mutation.id, status: "recovery_required" },
    select: { id: true },
  });
  const base = { stepId: null, itemName: null, isFolder: false, places: [] };
  if (!child) return clearInspection(context, base);
  return finishInspection(
    context,
    { ...base, group: "waiting", waitingFor: child.id },
    {},
  );
};

const inspectStop = async (context: ReviewContext) => {
  const { mutation } = context;
  if (PARENT_KINDS.has(mutation.kind)) {
    return { ...(await inspectParent(context)), step: null, resetStepIds: [] };
  }
  if (mutation.kind === "legacy_recovery") {
    return {
      ...(await inspectLegacyResidue(context)),
      step: null,
      resetStepIds: [],
    };
  }
  if (mutation.metadataCommittedAt) {
    const step =
      cleanupSteps(mutation).find(
        (candidate) => candidate.status !== "applied",
      ) ?? null;
    if (!step) {
      return {
        ...clearInspection(context, {
          stepId: null,
          itemName: null,
          isFolder: false,
          places: [],
        }),
        step,
        resetStepIds: [],
      };
    }
    return {
      ...(await inspectTargetOnly(
        context,
        step,
        "leftover",
        originOf(mutation, step.targetKey ?? ""),
      )),
      step,
      resetStepIds: [],
    };
  }
  const { stop, reset } = await findForwardStop(context);
  if (!stop) {
    const plans: Partial<Record<StorageReviewChoice, ReviewPlan>> = canUndo(
      mutation,
    )
      ? {
          undo: {
            obstacles: [],
            rewrite: { type: "undo", itemKey: null, refresh: false },
          },
        }
      : {};
    return {
      ...finishInspection(
        context,
        {
          stepId: null,
          itemName: null,
          isFolder: false,
          places: [],
          group: "broken",
        },
        plans,
      ),
      step: null,
      resetStepIds: reset,
    };
  }
  const inspected =
    stop.action === "rename" || stop.action === "set_aside"
      ? await inspectRename(context, stop)
      : await inspectTargetOnly(context, stop, "new", null);
  return { ...inspected, step: stop, resetStepIds: reset };
};

const createContext = async (
  mutation: Mutation,
  filesRoot: string,
): Promise<ReviewContext> => {
  const [owner, traits] = await Promise.all([
    getPrisma().user.findUniqueOrThrow({
      where: { id: mutation.ownerUserId },
      select: { storageId: true },
    }),
    assertStorageFilesystemSupported(filesRoot),
  ]);
  return {
    mutation,
    filesRoot,
    storageId: owner.storageId,
    ignoresCase: traits.ignoresCase,
    stamp: await copyStamp(
      mutation.ownerUserId,
      mutation.recoveryRequiredAt ?? mutation.createdAt,
    ),
    takenKeys: new Set(),
  };
};

// A check that cannot run, even the disk probe on a full volume, still shows
// the change, with only Check again to offer.
const inspectMutation = async (
  mutation: Mutation,
  filesRoot: string,
): Promise<Inspected> => {
  try {
    return await inspectStop(await createContext(mutation, filesRoot));
  } catch (error) {
    return {
      ...finishInspection(
        { mutation },
        {
          stepId: null,
          itemName: null,
          isFolder: false,
          places: [],
          group: "broken",
          error: error instanceof Error ? error.message : "Unknown error.",
        },
        {},
      ),
      step: null,
      resetStepIds: [],
    };
  }
};

const writeReviewRecord = (
  client: Pick<Prisma.TransactionClient, "storageMutation">,
  mutationId: string,
  record: StorageReviewRecord,
  extra: Prisma.StorageMutationUpdateManyMutationInput = {},
) =>
  client.storageMutation.updateMany({
    where: { id: mutationId, status: "recovery_required" },
    data: { reviewJson: record as unknown as Prisma.InputJsonValue, ...extra },
  });

// Only the inspection: a fix recorded while the disk was being checked stays.
const saveInspection = (
  mutationId: string,
  inspection: StorageReviewInspection,
) =>
  getPrisma().$executeRaw`
    UPDATE "StorageMutation"
    SET "reviewJson" = jsonb_set(
      COALESCE("reviewJson", '{"fixes": []}'::jsonb),
      '{inspection}',
      ${JSON.stringify(inspection)}::jsonb
    )
    WHERE id = ${mutationId} AND status = 'recovery_required'`;

/** Checks a stopped change on disk again and saves what it found. */
export const refreshStorageReviewInspection = async ({
  mutationId,
  filesRoot,
}: {
  mutationId: string;
  filesRoot: string;
}) => {
  const mutation = await findStorageMutation(mutationId);
  if (mutation?.status !== "recovery_required") return null;
  const { inspection } = await inspectMutation(mutation, filesRoot);
  await saveInspection(mutationId, inspection);
  return inspection;
};

export const storageReviewInspectionIsCurrent = (mutation: {
  recoveryRequiredAt: Date | null;
  reviewJson: unknown;
}) => {
  const checkedAt = readStorageReviewRecord(mutation.reviewJson).inspection
    ?.checkedAt;
  return Boolean(
    checkedAt &&
    mutation.recoveryRequiredAt &&
    new Date(checkedAt) >= mutation.recoveryRequiredAt,
  );
};

const unfinishedKeepOf = (
  mutationId: string,
  client: Pick<Prisma.TransactionClient, "storageMutation"> = getPrisma(),
) =>
  client.storageMutation.findFirst({
    where: {
      kind: KEEP_KIND,
      idempotencyKey: { startsWith: keepKeyPrefix(mutationId) },
      status: { notIn: ["succeeded", "aborted"] },
    },
    select: { id: true, status: true },
  });

type KeepPlan = {
  input: Parameters<typeof prepareStorageMutation>[0];
  kept: Array<Omit<StorageReviewKeptItem, "keepMutationId">>;
  removedEmptyFolders: number;
};

const mimeTypeFor = (name: string) => resolveUploadMimeType("", name);

const keptRows = (
  owner: { id: string; mutationId: string; sequence: number },
  place: CopyPlace,
  captured: CapturedStorageNode,
) => {
  const idFor = (relative: string) =>
    stableId(`${owner.mutationId}:${owner.sequence}:${place.key}:${relative}`);
  const operations: StorageMetadataOperation[] = [];
  const entities: StorageMutationEntityInput[] = [];
  const created = (
    entityType: "file" | "folder",
    entityId: string,
    storageKey: string,
  ) =>
    entities.push({
      entityType,
      entityId,
      preRevision: -1,
      postRevision: 0,
      beforeJson: null,
      afterJson: { storageKey },
    });
  const rootId = idFor("");
  if (captured.type === "file") {
    operations.push({
      action: "create_file",
      data: {
        id: rootId,
        ownerUserId: owner.id,
        folderId: place.folder!.id,
        originalName: place.name,
        storageKey: place.key,
        mimeType: mimeTypeFor(place.name),
        sizeBytes: String(captured.sizeBytes),
        contentChecksum: captured.checksum,
      },
    });
    created("file", rootId, place.key);
    return { operations, entities, rootId };
  }
  operations.push({
    action: "create_folder",
    data: {
      id: rootId,
      ownerUserId: owner.id,
      parentId: place.folder!.id,
      name: place.name,
    },
  });
  created("folder", rootId, place.key);
  for (const entry of captured.entries) {
    const parent = path.posix.dirname(entry.relativeKey);
    const parentId = idFor(parent === "." ? "" : parent);
    const entityId = idFor(entry.relativeKey);
    const name = path.posix.basename(entry.relativeKey);
    const storageKey = `${place.key}/${entry.relativeKey}`;
    if (entry.kind === "directory") {
      operations.push({
        action: "create_folder",
        data: { id: entityId, ownerUserId: owner.id, parentId, name },
      });
      created("folder", entityId, storageKey);
    } else {
      operations.push({
        action: "create_file",
        data: {
          id: entityId,
          ownerUserId: owner.id,
          folderId: parentId,
          originalName: name,
          storageKey,
          mimeType: mimeTypeFor(name),
          sizeBytes: String(entry.sizeBytes),
          contentChecksum: entry.checksum,
        },
      });
      created("file", entityId, storageKey);
    }
  }
  return { operations, entities, rootId };
};

const buildKeepPlan = async (
  context: ReviewContext,
  obstacles: Obstacle[],
  sequence: number,
): Promise<KeepPlan | null> => {
  if (obstacles.length === 0) return null;
  const { mutation } = context;
  const steps: StorageMutationStepInput[] = [];
  const operations: StorageMetadataOperation[] = [];
  const entities: StorageMutationEntityInput[] = [];
  const kept: KeepPlan["kept"] = [];
  const guards = new Map<string, number>();
  const resourceKeys: string[] = [];
  const lock = (storageKey: string) =>
    resourceKeys.push(storagePathResourceKey(mutation.ownerUserId, storageKey));
  for (const obstacle of obstacles) {
    lock(obstacle.key);
    if (obstacle.drop) {
      steps.push({ action: "remove_empty_tree", targetKey: obstacle.key });
      continue;
    }
    const place = obstacle.place!;
    lock(place.key);
    const captured = await captureStorageNode(context.filesRoot, obstacle.key);
    steps.push({
      action: "set_aside",
      sourceKey: obstacle.key,
      targetKey: place.key,
      expectedNodeType: captured.type,
      ...(captured.type === "file"
        ? {
            expectedSizeBytes: captured.sizeBytes,
            expectedChecksum: captured.checksum,
          }
        : { treeManifestDigest: captured.treeManifestDigest }),
    });
    if (!place.folder) continue;
    guards.set(place.folder.id, place.folder.storageRevision);
    const rows = keptRows(
      { id: mutation.ownerUserId, mutationId: mutation.id, sequence },
      place,
      captured,
    );
    operations.push(...rows.operations);
    entities.push(...rows.entities);
    kept.push({
      itemId: rows.rootId,
      kind: captured.type === "file" ? "file" : "folder",
      name: place.name,
    });
  }
  if (operations.length > STORAGE_MUTATION_CHUNK_SIZE) return null;
  const intentJson = {
    version: 1 as const,
    metadataOperations: operations,
    review: { keepFor: mutation.id },
  };
  return {
    input: {
      kind: KEEP_KIND,
      ownerUserId: mutation.ownerUserId,
      idempotencyKey: `${keepKeyPrefix(mutation.id)}${sequence}`,
      requestHash: hashStorageMutationRequest({ steps, operations }),
      intentJson: intentJson as unknown as Prisma.InputJsonValue,
      resourceKeys,
      steps,
      entities,
      folderGuards: [...guards].map(([folderId, revision]) => ({
        folderId,
        revision,
      })),
      namesIgnoreCase: context.ignoresCase,
      sharedWithMutationId: mutation.id,
    },
    kept,
    removedEmptyFolders: obstacles.filter((obstacle) => obstacle.drop).length,
  };
};

const reviewLeaseOwner = (who: string) =>
  `storage-review:${who}:${process.pid}`;

/** Runs a prepared or resumed change now, the way worker recovery would. */
export const executeReviewedStorageMutation = async ({
  mutationId,
  filesRoot,
  leaseOwner,
}: {
  mutationId: string;
  filesRoot: string;
  leaseOwner: string;
}) => {
  const current = await findStorageMutation(mutationId);
  if (!current) return null;
  if (
    current.status === "metadata_committed" ||
    current.status === "finalizing"
  ) {
    await recoverStorageMutationCleanup({ mutationId, filesRoot, leaseOwner });
  } else if (!PARENT_KINDS.has(current.kind)) {
    const claimed = await claimStorageMutation({ id: mutationId, leaseOwner });
    if (claimed) {
      await executeClaimedStorageMutation({
        mutation: claimed,
        filesRoot,
        leaseOwner,
        leaseToken: claimed.leaseToken,
        commitMetadata: (tx) =>
          applyStorageMutationIntentMetadata(tx, claimed.intentJson),
      });
    }
  }
  return (await findStorageMutation(mutationId))?.status ?? null;
};

const runKeepPlan = async (
  keep: KeepPlan,
  filesRoot: string,
  onPrepared: NonNullable<KeepPlan["input"]["onPrepared"]>,
) => {
  const prepared = await prepareStorageMutation({ ...keep.input, onPrepared });
  const status = await executeReviewedStorageMutation({
    mutationId: prepared.mutation.id,
    filesRoot,
    leaseOwner: reviewLeaseOwner("keep"),
  }).catch(() => null);
  return { id: prepared.mutation.id, succeeded: status === "succeeded" };
};

type RefreshResult = {
  stepPatch: Prisma.StorageMutationStepUpdateManyMutationInput;
  operations: StorageMetadataOperation[];
  entities: StorageMutationEntityInput[];
};

const revisionAfterOperations = (mutation: Mutation, entityId: string) =>
  operationsOf(mutation).filter(
    (operation) =>
      operation.action === "update" && operation.entityId === entityId,
  ).length;

/**
 * Describes the item as it is on disk now: new size and checksum for a file;
 * for a folder, rows for files that appeared, new sizes for files that
 * changed, and "missing" for files that are gone. `finalKey` is where the
 * item ends up; `kept` is whether the change's own operations still run.
 */
// fallow-ignore-next-line complexity
const refreshItem = async (
  context: ReviewContext,
  step: Step,
  itemKey: string,
  finalKey: string,
  kept: boolean,
): Promise<RefreshResult | null> => {
  const { mutation } = context;
  const captured = await captureStorageNode(context.filesRoot, itemKey);
  const revisionOf = (entity: ItemEntity) =>
    entity.preRevision +
    (kept ? revisionAfterOperations(mutation, entity.entityId) : 0);
  if (captured.type === "file") {
    const stepPatch = {
      expectedNodeType: "file",
      expectedChecksum: captured.checksum,
      expectedSizeBytes: captured.sizeBytes,
      expectedFileStat: null,
      treeManifestDigest: null,
    };
    const created = createdFileOpOf(mutation, finalKey);
    if (created && kept) {
      created.data.sizeBytes = String(captured.sizeBytes);
      created.data.contentChecksum = captured.checksum;
      return { stepPatch, operations: [], entities: [] };
    }
    const entity = itemEntityOf(mutation, step);
    if (!entity) return null;
    return {
      stepPatch,
      operations: [
        {
          action: "update",
          entityType: "file",
          entityId: entity.entityId,
          preRevision: revisionOf(entity),
          data: {
            sizeBytes: String(captured.sizeBytes),
            contentChecksum: captured.checksum,
          },
        },
      ],
      entities: [],
    };
  }
  const root = itemEntityOf(mutation, step);
  if (!root || root.entityType !== "folder" || !step.sourceKey) return null;
  const folders = new Map(
    mutation.entities
      .filter((entity) => entity.entityType === "folder")
      .map((entity) => [entity.entityId, entity]),
  );
  const relativeOf = (folderId: string): string | null => {
    if (folderId === root.entityId) return "";
    const entity = folders.get(folderId);
    const json = jsonOf(entity?.beforeJson);
    const parent =
      typeof json.parentId === "string" ? relativeOf(json.parentId) : null;
    return parent === null ? null : path.posix.join(parent, String(json.name));
  };
  const folderIdByRelative = new Map<string, string>();
  for (const id of folders.keys()) {
    const relative = relativeOf(id);
    if (relative !== null) folderIdByRelative.set(relative, id);
  }
  const files = mutation.entities.filter((entity) => {
    const key = jsonOf(entity.beforeJson).storageKey;
    return (
      entity.entityType === "file" &&
      typeof key === "string" &&
      key.startsWith(`${step.sourceKey}/`)
    );
  });
  const rows = new Map(
    (
      await getPrisma().file.findMany({
        where: { id: { in: files.map((entity) => entity.entityId) } },
        select: { id: true, sizeBytes: true, contentChecksum: true },
      })
    ).map((row) => [row.id, row]),
  );
  const fileByRelative = new Map(
    files.map((entity) => [
      String(jsonOf(entity.beforeJson).storageKey).slice(
        step.sourceKey!.length + 1,
      ),
      entity,
    ]),
  );
  const creates: StorageMetadataOperation[] = [];
  const updates: StorageMetadataOperation[] = [];
  const entities: StorageMutationEntityInput[] = [];
  const seen = new Set<string>();
  const idFor = (relative: string) =>
    stableId(`${mutation.id}:refresh:${finalKey}:${relative}`);
  for (const entry of captured.entries) {
    const parent = path.posix.dirname(entry.relativeKey);
    const parentRelative = parent === "." ? "" : parent;
    const parentId =
      folderIdByRelative.get(parentRelative) ?? idFor(parentRelative);
    const name = path.posix.basename(entry.relativeKey);
    const storageKey = `${finalKey}/${entry.relativeKey}`;
    if (entry.kind === "directory") {
      if (folderIdByRelative.has(entry.relativeKey)) continue;
      const id = idFor(entry.relativeKey);
      creates.push({
        action: "create_folder",
        data: { id, ownerUserId: mutation.ownerUserId, parentId, name },
      });
      entities.push({
        entityType: "folder",
        entityId: id,
        preRevision: -1,
        postRevision: 0,
        beforeJson: null,
        afterJson: { storageKey },
      });
      continue;
    }
    const known = fileByRelative.get(entry.relativeKey);
    if (!known) {
      const id = idFor(entry.relativeKey);
      creates.push({
        action: "create_file",
        data: {
          id,
          ownerUserId: mutation.ownerUserId,
          folderId: parentId,
          originalName: name,
          storageKey,
          mimeType: mimeTypeFor(name),
          sizeBytes: String(entry.sizeBytes),
          contentChecksum: entry.checksum,
        },
      });
      entities.push({
        entityType: "file",
        entityId: id,
        preRevision: -1,
        postRevision: 0,
        beforeJson: null,
        afterJson: { storageKey },
      });
      continue;
    }
    seen.add(known.entityId);
    const row = rows.get(known.entityId);
    if (
      row?.sizeBytes === entry.sizeBytes &&
      row.contentChecksum === entry.checksum
    ) {
      continue;
    }
    updates.push({
      action: "update",
      entityType: "file",
      entityId: known.entityId,
      preRevision: revisionOf(known),
      data: {
        sizeBytes: String(entry.sizeBytes),
        contentChecksum: entry.checksum,
      },
    });
  }
  const now = new Date().toISOString();
  for (const entity of files) {
    if (seen.has(entity.entityId)) continue;
    updates.push({
      action: "update",
      entityType: "file",
      entityId: entity.entityId,
      preRevision: revisionOf(entity),
      data: { storageStatus: "missing", storageMissingAt: now },
    });
  }
  const operations = [...creates, ...updates];
  if (operations.length > STORAGE_MUTATION_CHUNK_SIZE) return null;
  return {
    stepPatch: {
      expectedNodeType: "directory",
      treeManifestDigest: captured.treeManifestDigest,
      expectedChecksum: null,
      expectedSizeBytes: null,
      expectedFileStat: null,
    },
    operations,
    entities,
  };
};

const deleteOperation = (
  entityType: "file" | "folder",
  entityId: string,
  preRevision: number,
): StorageMetadataOperation => ({
  action: "delete",
  entityType,
  entityId,
  preRevision,
});

type TreeFolder = {
  id: string;
  storageRevision: number;
  trashEntryId: string | null;
  depth: number;
};

const folderTree = (rootId: string) =>
  getPrisma().$queryRaw<TreeFolder[]>`
    WITH RECURSIVE tree AS (
      SELECT id, "storageRevision", "trashEntryId", 0 AS depth
        FROM "Folder" WHERE id = ${rootId}
      UNION ALL
      SELECT f.id, f."storageRevision", f."trashEntryId", tree.depth + 1
        FROM "Folder" f JOIN tree ON f."parentId" = tree.id
    )
    SELECT id, "storageRevision", "trashEntryId", depth FROM tree`;

/**
 * The rows of an item that is in neither place: the file, or the folder with
 * everything inside it. Refuses when something inside keeps its bytes
 * elsewhere, such as an item trashed on its own, so no stored file loses its
 * row.
 */
const removeItemOperations = async (
  mutation: Mutation,
  step: Step,
): Promise<Pick<StepRewrite, "operations" | "entities"> | null> => {
  const root = itemEntityOf(mutation, step);
  if (!root) return null;
  const trashEntry = await getPrisma().trashEntry.findFirst({
    where: { rootEntityId: root.entityId },
    select: { id: true },
  });
  const dropTrashEntry: StorageMetadataOperation[] = trashEntry
    ? [{ action: "delete_trash_entry", entityId: trashEntry.id }]
    : [];
  if (root.entityType === "file") {
    return {
      operations: [
        deleteOperation("file", root.entityId, root.preRevision),
        ...dropTrashEntry,
      ],
      entities: [],
    };
  }
  const folders = await folderTree(root.entityId);
  const rootTrash = folders[0]?.trashEntryId ?? null;
  const files = await getPrisma().file.findMany({
    where: { folderId: { in: folders.map((folder) => folder.id) } },
    select: { id: true, storageRevision: true, storageKey: true },
  });
  const inItem = (key: string) =>
    [step.sourceKey, step.targetKey].some(
      (base) => base && key.startsWith(`${base}/`),
    );
  if (
    !files.every((file) => inItem(file.storageKey)) ||
    folders.some(
      (folder) => (folder.trashEntryId ?? rootTrash) !== rootTrash,
    ) ||
    folders.length + files.length > STORAGE_MUTATION_CHUNK_SIZE
  ) {
    return null;
  }
  // Rows inside the folder that the change did not list get locked too.
  const listed = new Set(
    mutation.entities.map(
      (entity) => `${entity.entityType}:${entity.entityId}`,
    ),
  );
  const lock = (
    entityType: "file" | "folder",
    row: { id: string; storageRevision: number },
  ): StorageMutationEntityInput[] =>
    listed.has(`${entityType}:${row.id}`)
      ? []
      : [
          {
            entityType,
            entityId: row.id,
            preRevision: row.storageRevision,
            postRevision: row.storageRevision + 1,
            beforeJson: null,
            afterJson: null,
          },
        ];
  return {
    operations: [
      ...files.map((file) =>
        deleteOperation("file", file.id, file.storageRevision),
      ),
      ...[...folders]
        .sort((left, right) => right.depth - left.depth)
        .map((folder) =>
          deleteOperation("folder", folder.id, folder.storageRevision),
        ),
      ...dropTrashEntry,
    ],
    entities: [
      ...files.flatMap((file) => lock("file", file)),
      ...folders.flatMap((folder) => lock("folder", folder)),
    ],
  };
};

type StepRewrite = {
  deleteStepIds: string[];
  pendingStepIds: string[];
  appliedStepIds: string[];
  patch?: {
    stepId: string;
    data: Prisma.StorageMutationStepUpdateManyMutationInput;
  };
  newSteps: StorageMutationStepInput[];
  operations: StorageMetadataOperation[];
  entities: StorageMutationEntityInput[];
  undone: boolean;
};

const withoutQuotaChecks = (operations: StorageMetadataOperation[]) =>
  operations.filter((operation) => operation.action !== "assert_owner_quota");

// fallow-ignore-next-line complexity
const planStepRewrite = async (
  context: ReviewContext,
  inspected: Inspected,
  rewrite: Rewrite,
): Promise<StepRewrite | null> => {
  const { mutation } = context;
  const step = inspected.step;
  const keep: StepRewrite = {
    deleteStepIds: [],
    pendingStepIds: inspected.resetStepIds,
    appliedStepIds: [],
    newSteps: [],
    operations: withoutQuotaChecks(operationsOf(mutation)),
    entities: [],
    undone: false,
  };
  if (rewrite.type === "resume") return keep;
  if (!step) {
    return rewrite.type === "undo"
      ? undoRewrite(context, inspected, null, null)
      : null;
  }
  if (rewrite.type === "skip") {
    return { ...keep, appliedStepIds: [step.id] };
  }
  if (rewrite.type === "refresh") {
    const refresh = await refreshItem(
      context,
      step,
      rewrite.itemKey,
      step.targetKey!,
      true,
    );
    if (!refresh) return null;
    return {
      ...keep,
      patch: { stepId: step.id, data: refresh.stepPatch },
      operations: [
        ...withoutQuotaChecks(operationsOf(mutation)),
        ...refresh.operations,
      ],
      entities: refresh.entities,
    };
  }
  if (rewrite.type === "undo") {
    const refresh =
      rewrite.refresh && rewrite.itemKey
        ? await refreshItem(
            context,
            step,
            rewrite.itemKey,
            step.sourceKey!,
            false,
          )
        : null;
    if (rewrite.refresh && !refresh) return null;
    return undoRewrite(context, inspected, rewrite.itemKey, refresh);
  }
  if (rewrite.type === "drop_item") {
    const operations = withoutQuotaChecks(operationsOf(mutation)).filter(
      (operation) =>
        !(
          operation.action === "create_file" &&
          operation.data.storageKey === step.targetKey
        ),
    );
    return { ...keep, deleteStepIds: [step.id], operations };
  }
  const removed = await removeItemOperations(mutation, step);
  if (!removed) return null;
  return {
    ...keep,
    deleteStepIds: mutation.steps
      .filter((candidate) => candidate.status !== "applied")
      .map((candidate) => candidate.id),
    ...removed,
  };
};

const stepFingerprint = (step: Step) => ({
  expectedNodeType: step.expectedNodeType as "file" | "directory" | null,
  expectedSizeBytes: step.expectedSizeBytes,
  expectedChecksum: step.expectedChecksum,
  treeManifestDigest: step.treeManifestDigest,
});

/**
 * Undo as a forward plan: every rename that landed goes back, newest first,
 * and every folder it made is removed if it is still empty. The change's own
 * operations are dropped; only the item's new size, when it changed, commits.
 */
const undoRewrite = async (
  context: ReviewContext,
  inspected: Inspected,
  itemKey: string | null,
  refresh: RefreshResult | null,
): Promise<StepRewrite> => {
  const { mutation } = context;
  const reset = new Set(inspected.resetStepIds);
  const isItem = (step: Step) => step.id === inspected.step?.id;
  const landed = (step: Step) =>
    isItem(step)
      ? itemKey === step.targetKey
      : step.status === "applied" && !reset.has(step.id);
  // The stopped item goes back as it is now, the rest as they were captured.
  const fingerprint = (step: Step) =>
    isItem(step) && refresh
      ? (refresh.stepPatch as Partial<StorageMutationStepInput>)
      : stepFingerprint(step);
  const newSteps = [...forwardSteps(mutation)]
    .reverse()
    .filter(landed)
    .flatMap((step): StorageMutationStepInput[] => {
      if (step.action === "mkdir") {
        return [{ action: "remove_empty_tree", targetKey: step.targetKey }];
      }
      if (step.action !== "rename") return [];
      return [
        {
          action: "rename",
          sourceKey: step.targetKey,
          targetKey: step.sourceKey,
          ...fingerprint(step),
        },
      ];
    });
  return {
    deleteStepIds: mutation.steps
      .filter((step) => step.status !== "applied")
      .map((step) => step.id),
    pendingStepIds: [],
    appliedStepIds: [],
    newSteps,
    operations: refresh?.operations ?? [],
    entities: refresh?.entities ?? [],
    undone: true,
  };
};

class StorageReviewChangedError extends Error {}

const rewrittenIntent = (mutation: Mutation, rewrite: StepRewrite) => {
  const intent = mutation.intentJson as Record<string, unknown>;
  // A parent keeps its own plan format; it only resumes.
  if (PARENT_KINDS.has(mutation.kind)) return intent;
  const { bulkOperationsEnd: _bulk, ...rest } = intent;
  // An Undo that stopped and is fixed again is still an Undo.
  const undone =
    rewrite.undone || storageReviewOutcomeOf(mutation.intentJson) === "undone";
  return {
    ...(undone ? rest : intent),
    metadataOperations: rewrite.operations,
    review: { outcome: undone ? "undone" : "fixed" },
  };
};

const applyStepRewrite = async ({
  mutation,
  rewrite,
  record,
}: {
  mutation: Mutation;
  rewrite: StepRewrite;
  record: StorageReviewRecord;
}) =>
  runStorageTransaction(async (tx) => {
    const now = new Date();
    const nextIntent = rewrittenIntent(mutation, rewrite);
    const updated = await tx.storageMutation.updateMany({
      where: {
        id: mutation.id,
        status: "recovery_required",
        recoveryRequiredAt: mutation.recoveryRequiredAt,
      },
      data: {
        status: mutation.metadataCommittedAt ? "finalizing" : "retrying",
        intentJson: nextIntent as unknown as Prisma.InputJsonValue,
        reviewJson: record as unknown as Prisma.InputJsonValue,
        reviewedAt: now,
        reviewNoticeSeenAt: null,
        nextAttemptAt: now,
        lastError: null,
      },
    });
    if (updated.count !== 1) throw new StorageReviewChangedError();
    // Read after the row lock: a keep written first borrows this change's
    // locks, so it must finish before this change runs again.
    if (await unfinishedKeepOf(mutation.id, tx)) {
      throw new StorageReviewChangedError();
    }
    if (rewrite.deleteStepIds.length) {
      await tx.storageMutationStep.deleteMany({
        where: { mutationId: mutation.id, id: { in: rewrite.deleteStepIds } },
      });
    }
    if (rewrite.pendingStepIds.length) {
      await tx.storageMutationStep.updateMany({
        where: { mutationId: mutation.id, id: { in: rewrite.pendingStepIds } },
        data: { status: "pending", appliedAt: null },
      });
    }
    if (rewrite.appliedStepIds.length) {
      await tx.storageMutationStep.updateMany({
        where: { mutationId: mutation.id, id: { in: rewrite.appliedStepIds } },
        data: { status: "applied", appliedAt: now, lastError: null },
      });
    }
    if (rewrite.patch) {
      await tx.storageMutationStep.updateMany({
        where: { mutationId: mutation.id, id: rewrite.patch.stepId },
        data: { ...rewrite.patch.data, lastError: null },
      });
    }
    if (rewrite.newSteps.length) {
      const last = Math.max(-1, ...mutation.steps.map((step) => step.ordinal));
      await tx.storageMutationStep.createMany({
        data: rewrite.newSteps.map((step, index) => ({
          mutationId: mutation.id,
          ordinal: last + 1 + index,
          action: step.action,
          sourceKey: step.sourceKey ?? null,
          targetKey: step.targetKey ?? null,
          expectedNodeType: step.expectedNodeType ?? null,
          expectedSizeBytes: step.expectedSizeBytes ?? null,
          expectedChecksum: step.expectedChecksum ?? null,
          treeManifestDigest: step.treeManifestDigest ?? null,
        })),
      });
    }
    if (rewrite.entities.length) {
      await tx.storageMutationEntity.createMany({
        data: rewrite.entities.map((entity) => ({
          mutationId: mutation.id,
          entityType: entity.entityType,
          entityId: entity.entityId,
          preRevision: entity.preRevision,
          postRevision: entity.postRevision,
          beforeJson: Prisma.JsonNull,
          afterJson: (entity.afterJson ??
            Prisma.JsonNull) as Prisma.InputJsonValue,
        })),
      });
    }
    // A batch or trash parent stopped because this child did; it can go on.
    if (mutation.parentId) {
      await tx.storageMutation.updateMany({
        where: { id: mutation.parentId, status: "recovery_required" },
        data: { status: "retrying", nextAttemptAt: now, lastError: null },
      });
    }
  });

export type StorageReviewResult =
  | { outcome: "resumed"; kept: StorageReviewKeptItem[] }
  | { outcome: "changed"; inspection: StorageReviewInspection | null }
  | { outcome: "busy"; mutationId?: string }
  | { outcome: "stopped"; mutationId: string };

const guardOf = (inspection: StorageReviewInspection) =>
  `${inspection.stepId ?? "none"}:${inspection.group}`;

/**
 * Applies one choice for a stopped change. The disk is checked again first;
 * a choice that no longer fits is refused with what was found instead.
 */
// fallow-ignore-next-line complexity
export const applyStorageReviewChoice = async ({
  mutationId,
  choice,
  seen,
  filesRoot,
  byUserId,
  automatic = false,
}: {
  mutationId: string;
  choice: StorageReviewChoice;
  /** The `seen` digest of the inspection the choice answers. */
  seen: string | null;
  filesRoot: string;
  byUserId: string | null;
  automatic?: boolean;
}): Promise<StorageReviewResult> => {
  const mutation = await findStorageMutation(mutationId);
  if (mutation?.status !== "recovery_required") {
    return { outcome: "changed", inspection: null };
  }
  const waiting = await unfinishedKeepOf(mutationId);
  if (waiting) return { outcome: "busy", mutationId: waiting.id };
  const context = await createContext(mutation, filesRoot);
  const inspected = await inspectStop(context);
  const record = readStorageReviewRecord(mutation.reviewJson);
  const plan = inspected.plans[choice];
  // A choice answers what the owner (or the worker) saw. If the disk now tells
  // a different story, show that instead of acting on it.
  const sawSomethingElse =
    choice !== "retry" && seen !== inspected.inspection.seen;
  if (
    !plan ||
    sawSomethingElse ||
    (automatic && inspected.inspection.auto !== choice)
  ) {
    await saveInspection(mutationId, inspected.inspection);
    return { outcome: "changed", inspection: inspected.inspection };
  }
  const rewrite = await planStepRewrite(context, inspected, plan.rewrite);
  if (!rewrite) {
    return { outcome: "changed", inspection: inspected.inspection };
  }
  const fix: StorageReviewFix = {
    choice,
    automatic,
    byUserId,
    at: new Date().toISOString(),
    group: inspected.inspection.group,
    guard: guardOf(inspected.inspection),
    kept: [],
    removedEmptyFolders: 0,
  };
  const keepPlan = await buildKeepPlan(
    context,
    plan.obstacles,
    record.fixes.length,
  );
  if (plan.obstacles.length && !keepPlan) {
    return { outcome: "changed", inspection: inspected.inspection };
  }
  if (keepPlan) {
    const keptBy = (keepMutationId: string) =>
      keepPlan.kept.map((item) => ({ ...item, keepMutationId }));
    fix.removedEmptyFolders = keepPlan.removedEmptyFolders;
    // Recorded with the keep change itself, so the person still hears about
    // the copy if anything stops before this change resumes. Without an
    // inspection, the worker checks the change again once the keep is done.
    const keep = await runKeepPlan(keepPlan, filesRoot, (tx, keepId) =>
      writeReviewRecord(tx, mutationId, {
        fixes: [...record.fixes, { ...fix, kept: keptBy(keepId) }],
      }),
    ).catch(() => null);
    if (!keep) return { outcome: "busy" };
    fix.kept = keptBy(keep.id);
    if (!keep.succeeded) return { outcome: "stopped", mutationId: keep.id };
  }
  try {
    await applyStepRewrite({
      mutation,
      rewrite,
      record: {
        inspection: inspected.inspection,
        fixes: [...record.fixes, fix],
      },
    });
  } catch (error) {
    if (error instanceof StorageReviewChangedError) {
      return { outcome: "changed", inspection: null };
    }
    throw error;
  }
  return { outcome: "resumed", kept: fix.kept };
};

const triedBefore = (record: StorageReviewRecord) =>
  record.fixes.some(
    (fix) =>
      fix.automatic &&
      record.inspection &&
      fix.guard === guardOf(record.inspection),
  );

type StoppedCandidate = {
  id: string;
  recoveryRequiredAt: Date | null;
  reviewJson: Prisma.JsonValue;
};

// A check the owner's page already saved still counts when it found an
// automatic fix the worker has not tried yet.
const needsWorker = (mutation: StoppedCandidate) => {
  if (!storageReviewInspectionIsCurrent(mutation)) return true;
  const record = readStorageReviewRecord(mutation.reviewJson);
  return Boolean(record.inspection?.auto) && !triedBefore(record);
};

const fixAutomatically = async (
  candidate: StoppedCandidate,
  filesRoot: string,
) => {
  if (await unfinishedKeepOf(candidate.id)) return false;
  const record = readStorageReviewRecord(candidate.reviewJson);
  const inspection = storageReviewInspectionIsCurrent(candidate)
    ? record.inspection
    : await refreshStorageReviewInspection({
        mutationId: candidate.id,
        filesRoot,
      });
  if (!inspection?.auto || triedBefore({ ...record, inspection })) {
    return false;
  }
  const result = await applyStorageReviewChoice({
    mutationId: candidate.id,
    choice: inspection.auto,
    seen: inspection.seen,
    filesRoot,
    byUserId: null,
    automatic: true,
  });
  return result.outcome === "resumed";
};

/**
 * Worker pass: checks every newly stopped change, and fixes it by itself when
 * only one answer keeps every byte. A step it already fixed once and that
 * stopped again is left for the owner.
 */
export const reviewStoppedStorageMutations = async ({
  filesRoot,
  take = 20,
}: {
  filesRoot: string;
  take?: number;
}) => {
  // Every stopped change, not a window: ones waiting for the owner never
  // leave this state and must not hide a newer one the worker can fix.
  const stopped = await getPrisma().storageMutation.findMany({
    where: { status: "recovery_required" },
    orderBy: { recoveryRequiredAt: "asc" },
    select: { id: true, recoveryRequiredAt: true, reviewJson: true },
  });
  let fixed = 0;
  for (const candidate of stopped.filter(needsWorker).slice(0, take)) {
    try {
      if (await fixAutomatically(candidate, filesRoot)) fixed += 1;
    } catch (error) {
      console.warn("[worker] Storage review deferred.", {
        mutationId: candidate.id,
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    }
  }
  return fixed;
};

export type RecoveredNoticeItem = {
  id: string;
  kind: "file" | "folder";
  name: string;
  /** The folder it sits in; null at the top of the drive. */
  folderId: string | null;
};

const noticeMutations = (ownerUserId: string) =>
  getPrisma().storageMutation.findMany({
    where: {
      ownerUserId,
      reviewedAt: { not: null },
      reviewNoticeSeenAt: null,
      status: { in: ["succeeded", "aborted"] },
    },
    select: { id: true, reviewJson: true },
    take: 50,
  });

/** Copies Staaash kept in this person's drive that they have not been told about. */
export const readRecoveredNotice = async (ownerUserId: string) => {
  const kept = (await noticeMutations(ownerUserId)).flatMap((mutation) =>
    readStorageReviewRecord(mutation.reviewJson).fixes.flatMap(
      (fix) => fix.kept,
    ),
  );
  if (kept.length === 0) return null;
  const [files, folders] = await Promise.all([
    getPrisma().file.findMany({
      where: {
        id: {
          in: kept
            .filter((item) => item.kind === "file")
            .map((item) => item.itemId),
        },
        deletedAt: null,
      },
      select: { id: true, originalName: true, folderId: true },
    }),
    getPrisma().folder.findMany({
      where: {
        id: {
          in: kept
            .filter((item) => item.kind === "folder")
            .map((item) => item.itemId),
        },
        deletedAt: null,
      },
      select: { id: true, name: true, parentId: true },
    }),
  ]);
  const roots = new Set(
    (
      await getPrisma().folder.findMany({
        where: { ownerUserId, isFilesRoot: true },
        select: { id: true },
      })
    ).map((folder) => folder.id),
  );
  const folderOf = (id: string | null) => (id && !roots.has(id) ? id : null);
  const items: RecoveredNoticeItem[] = [
    ...folders.map((folder) => ({
      id: folder.id,
      kind: "folder" as const,
      name: folder.name,
      folderId: folderOf(folder.parentId),
    })),
    ...files.map((file) => ({
      id: file.id,
      kind: "file" as const,
      name: file.originalName,
      folderId: folderOf(file.folderId),
    })),
  ];
  return items.length ? { items } : null;
};

export const markRecoveredNoticeSeen = async (ownerUserId: string) => {
  const mutations = await noticeMutations(ownerUserId);
  await getPrisma().storageMutation.updateMany({
    where: { id: { in: mutations.map((mutation) => mutation.id) } },
    data: { reviewNoticeSeenAt: new Date() },
  });
};

/** Recent changes a review resumed, newest first, for the admin Storage page. */
export const listReviewedStorageMutations = async (take = 10) =>
  (
    await getPrisma().storageMutation.findMany({
      where: { reviewedAt: { not: null }, kind: { not: KEEP_KIND } },
      orderBy: { reviewedAt: "desc" },
      take,
      select: {
        id: true,
        kind: true,
        status: true,
        ownerUserId: true,
        reviewedAt: true,
        reviewJson: true,
      },
    })
  ).map((mutation) => {
    const last = readStorageReviewRecord(mutation.reviewJson).fixes.at(-1);
    return {
      id: mutation.id,
      kind: mutation.kind,
      status: mutation.status,
      ownerUserId: mutation.ownerUserId,
      reviewedAt: mutation.reviewedAt!,
      choice: last?.choice ?? null,
      automatic: last?.automatic ?? false,
      byUserId: last?.byUserId ?? null,
      keptCount: last?.kept.length ?? 0,
    };
  });

/** One change with its review, for the fix page. */
export const readStorageReview = async (mutationId: string) => {
  const mutation = await getPrisma().storageMutation.findUnique({
    where: { id: mutationId },
    select: {
      id: true,
      kind: true,
      status: true,
      ownerUserId: true,
      createdAt: true,
      recoveryRequiredAt: true,
      reviewedAt: true,
      lastError: true,
      reviewJson: true,
      parentId: true,
    },
  });
  if (!mutation) return null;
  return {
    ...mutation,
    review: readStorageReviewRecord(mutation.reviewJson),
    inspectionIsCurrent: storageReviewInspectionIsCurrent(mutation),
  };
};

export const readStorageReviewSummaries = async (mutationIds: string[]) => {
  const rows = mutationIds.length
    ? await getPrisma().storageMutation.findMany({
        where: { id: { in: mutationIds } },
        select: { id: true, reviewJson: true },
      })
    : [];
  return new Map(
    rows.map((row) => {
      const inspection = readStorageReviewRecord(row.reviewJson).inspection;
      return [
        row.id,
        inspection
          ? {
              group: inspection.group,
              itemName: inspection.itemName,
              error: inspection.error ?? null,
            }
          : null,
      ];
    }),
  );
};
