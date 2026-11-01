import {
  requiredPasswordChangeInputSchema,
  type temporaryPasswordInputSchema,
} from "../../server/auth/schema";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resolveViewerKind } from "@staaash/db/viewer-contract";
import {
  type State,
  type File,
  type Folder,
  PreviewError,
  fileOf,
  folderOf,
  isDeleted,
  memoryLimit,
  password,
  requireUser,
  rootOf,
  timestamp,
  within,
  publicFile,
  publicFolder,
} from "./state";

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(255, "Use a shorter name.")
  .refine(
    (name) =>
      !Array.from({ length: 32 }, (_, i) => String.fromCharCode(i)).some(
        (char) => name.includes(char),
      ) &&
      !/[\\/]/.test(name) &&
      name !== "." &&
      name !== "..",
    "Use a name without path separators.",
  );
export function owned<T extends File | Folder>(state: State, item: T) {
  if (item.ownerUserId !== requireUser(state).id)
    throw new PreviewError(404, "Item not found.");
  return item;
}
export function destination(state: State, id: string) {
  const folder = owned(state, folderOf(state, id));
  if (isDeleted(state, folder))
    throw new PreviewError(409, "Choose a folder outside Trash.");
  return folder;
}
function availableName(
  state: State,
  parentId: string,
  name: string,
  except?: string,
) {
  if (
    [
      ...state.files.filter((f) => f.folderId === parentId),
      ...state.folders.filter((f) => f.parentId === parentId),
    ].some((i) => i.id !== except && !isDeleted(state, i) && i.name === name)
  )
    throw new PreviewError(
      409,
      "An item with that name already exists.",
      "NAME_CONFLICT",
    );
}
export function createFolder(state: State, parentId: string, name: string) {
  const parent = destination(state, parentId);
  name = nameSchema.parse(name);
  availableName(state, parent.id, name);
  const folder: Folder = {
    id: randomUUID(),
    ownerUserId: parent.ownerUserId,
    ownerStorageId: parent.ownerStorageId,
    parentId: parent.id,
    name,
    isFilesRoot: false,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    storageRevision: 1,
    favorite: false,
    pinned: false,
    color: null,
    icon: null,
  };
  state.folders.push(folder);
  return folder;
}
const parentOf = (item: File | Folder) =>
  "folderId" in item ? item.folderId : item.parentId;
function setParent(item: File | Folder, id: string) {
  if ("folderId" in item) item.folderId = id;
  else item.parentId = id;
}
function renameItem(
  state: State,
  item: File | Folder,
  body: Record<string, unknown>,
) {
  const name = nameSchema.parse(body.name);
  availableName(state, parentOf(item)!, name, item.id);
  item.name = name;
}
function moveItem(
  state: State,
  item: File | Folder,
  body: Record<string, unknown>,
) {
  const target = destination(
    state,
    z.string().parse(body.destinationFolderId ?? rootOf(state).id),
  );
  if (!("mimeType" in item) && within(state, target.id, item.id))
    throw new PreviewError(409, "A folder cannot move inside itself.");
  availableName(state, target.id, item.name, item.id);
  setParent(item, target.id);
}
function restoreItem(state: State, item: File | Folder) {
  const parent = parentOf(item);
  if (!parent || isDeleted(state, folderOf(state, parent)))
    setParent(item, rootOf(state).id);
  availableName(state, parentOf(item)!, item.name, item.id);
  item.deletedAt = null;
}
function favoriteItem(
  _state: State,
  item: File | Folder,
  body: Record<string, unknown>,
) {
  const change = z
    .union([
      z.object({ isFavorite: z.boolean() }),
      z.object({ quickAccessPinned: z.boolean() }),
    ])
    .parse(body);
  if ("isFavorite" in change) item.favorite = change.isFavorite;
  if ("quickAccessPinned" in change) {
    item.pinned = change.quickAccessPinned;
    item.favorite ||= item.pinned;
  }
  if (!item.favorite) item.pinned = false;
  return {
    kind: "mimeType" in item ? "file" : "folder",
    id: item.id,
    isFavorite: item.favorite,
    quickAccessPinnedAt: item.pinned ? timestamp : null,
  };
}
function deleteItem(state: State, item: File | Folder) {
  if (!item.deletedAt)
    throw new PreviewError(409, "Move the item to Trash first.");
  const folders =
    "mimeType" in item
      ? []
      : state.folders.filter((folder) => within(state, folder.id, item.id));
  const folderIds = new Set(folders.map((folder) => folder.id));
  const ids = new Set([
    item.id,
    ...folderIds,
    ...state.files
      .filter((file) => folderIds.has(file.folderId!))
      .map((file) => file.id),
  ]);
  state.files = state.files.filter((file) => !ids.has(file.id));
  state.folders = state.folders.filter((folder) => !ids.has(folder.id));
  for (const id of ids) state.blobs.delete(id);
  state.shares = state.shares.filter((share) => !ids.has(share.targetId));
  return { deletedFileId: item.id };
}
const actions: Record<
  string,
  (
    state: State,
    item: File | Folder,
    body: Record<string, unknown>,
  ) => object | void
> = {
  rename: renameItem,
  move: moveItem,
  restore: restoreItem,
  favorite: favoriteItem,
  delete: deleteItem,
  trash: (_state, item) => {
    item.deletedAt = timestamp;
  },
};
function mutableItem(state: State, kind: string, id: string) {
  const item = owned(
    state,
    kind === "files" ? fileOf(state, id) : folderOf(state, id),
  );
  if ("isFilesRoot" in item && item.isFilesRoot)
    throw new PreviewError(409, "The Files root cannot be changed.");
  return item;
}
export function changeItem(
  state: State,
  kind: string,
  id: string,
  action: string,
  body: Record<string, unknown>,
) {
  const item = mutableItem(state, kind, id);
  if (action === "opened") return { file: item };
  const apply = actions[action];
  if (!apply) throw new PreviewError(404, "Unknown sample action.");
  const result = apply(state, item, body);
  item.updatedAt = timestamp;
  item.storageRevision = (item.storageRevision ?? 1) + 1;
  if (result) return result;
  return "mimeType" in item
    ? { file: publicFile(item) }
    : { folder: publicFolder(item) };
}
export function addFile(
  state: State,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: Uint8Array<ArrayBuffer>,
) {
  const folder = destination(state, folderId);
  const used =
    [...state.blobs.values()].reduce((sum, b) => sum + b.byteLength, 0) +
    [...state.uploads.values()].reduce((sum, u) => sum + u.total, 0);
  if (used + bytes.byteLength > memoryLimit)
    throw new PreviewError(
      413,
      "The sample drive accepts up to 16 MiB of uploaded data. Reset it to clear uploads.",
    );
  name = nameSchema.parse(name);
  availableName(state, folder.id, name);
  if (state.scenario === "error")
    throw new PreviewError(
      503,
      "Sample upload failed. Choose another preview scenario.",
    );
  const file: File = {
    id: randomUUID(),
    name,
    mimeType,
    viewerKind: resolveViewerKind(mimeType, name),
    sizeBytes: bytes.byteLength,
    folderId: folder.id,
    ownerUserId: folder.ownerUserId,
    ownerStorageId: folder.ownerStorageId,
    asset: "",
    favorite: false,
    pinned: false,
    deletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    storageRevision: 1,
  };
  state.files.push(file);
  state.blobs.set(file.id, bytes);
  return file;
}
export function checkPassword(value: unknown, expected = password) {
  if (value !== expected)
    throw new PreviewError(
      401,
      "Use the sample password shown on the preview controls page.",
    );
}

export function sampleTemporaryPassword(
  body: z.infer<typeof temporaryPasswordInputSchema>,
) {
  if (body.generateTemporaryPassword) return password;
  const values = requiredPasswordChangeInputSchema.parse({
    password: body.temporaryPassword,
    confirmPassword: body.confirmTemporaryPassword,
  });
  if (values.password !== values.confirmPassword)
    throw new PreviewError(400, "Passwords do not match.");
  return values.password;
}
