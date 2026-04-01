import path from "node:path";
import { mkdir } from "node:fs/promises";

import { env } from "@/lib/env";

export const STORAGE_DIRECTORIES = {
  library: "library",
  trash: ".trash",
  previews: "previews",
  tmp: "tmp",
  locks: "tmp/locks",
  pendingDelete: "tmp/pending-delete",
} as const;

const resolveWithinRoot = (...segments: string[]) => {
  const root = path.resolve(env.FILES_ROOT);
  const resolved = path.resolve(root, ...segments);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Resolved path escaped the configured file root.");
  }

  return resolved;
};

export const getStorageRoot = () => path.resolve(env.FILES_ROOT);

export const getStoragePath = (storageKey: string) =>
  resolveWithinRoot(storageKey);

export const getTmpRootPath = () => resolveWithinRoot(STORAGE_DIRECTORIES.tmp);

export const getStorageLockDirectoryPath = () =>
  resolveWithinRoot(STORAGE_DIRECTORIES.locks);

export const getPendingDeleteDirectoryPath = () =>
  resolveWithinRoot(STORAGE_DIRECTORIES.pendingDelete);

export const getUserLibraryRootStorageKey = (username: string) =>
  path.posix.join(STORAGE_DIRECTORIES.library, username);

export const getUserTrashRootStorageKey = (username: string) =>
  path.posix.join(STORAGE_DIRECTORIES.trash, username);

const buildCommittedStorageKey = ({
  username,
  folderPathSegments,
  fileName,
  trashed,
}: {
  username: string;
  folderPathSegments: string[];
  fileName: string;
  trashed: boolean;
}) =>
  path.posix.join(
    trashed
      ? getUserTrashRootStorageKey(username)
      : getUserLibraryRootStorageKey(username),
    ...folderPathSegments,
    fileName,
  );

export const getActiveCommittedStorageKey = ({
  username,
  folderPathSegments,
  fileName,
}: {
  username: string;
  folderPathSegments: string[];
  fileName: string;
}) =>
  buildCommittedStorageKey({
    username,
    folderPathSegments,
    fileName,
    trashed: false,
  });

export const getTrashedCommittedStorageKey = ({
  username,
  folderPathSegments,
  fileName,
}: {
  username: string;
  folderPathSegments: string[];
  fileName: string;
}) =>
  buildCommittedStorageKey({
    username,
    folderPathSegments,
    fileName,
    trashed: true,
  });

export const getActiveFolderStorageKey = ({
  username,
  folderPathSegments,
}: {
  username: string;
  folderPathSegments: string[];
}) =>
  path.posix.join(
    getUserLibraryRootStorageKey(username),
    ...folderPathSegments,
  );

export const getTrashedFolderStorageKey = ({
  username,
  folderPathSegments,
}: {
  username: string;
  folderPathSegments: string[];
}) =>
  path.posix.join(getUserTrashRootStorageKey(username), ...folderPathSegments);

export const getPreviewStorageKey = (
  ownerUserId: string,
  fileId: string,
  previewKind: string,
) =>
  path.posix.join(
    STORAGE_DIRECTORIES.previews,
    ownerUserId,
    fileId,
    `${previewKind}.preview`,
  );

export const getTmpUploadPath = (uploadId: string) =>
  resolveWithinRoot(STORAGE_DIRECTORIES.tmp, `${uploadId}.upload`);

export const getStorageLockPath = (lockId: string) =>
  resolveWithinRoot(STORAGE_DIRECTORIES.locks, `${lockId}.lock`);

export const getPendingDeleteBlobPath = (operationId: string) =>
  resolveWithinRoot(STORAGE_DIRECTORIES.pendingDelete, `${operationId}.bin`);

export const getPendingDeleteManifestPath = (operationId: string) =>
  resolveWithinRoot(STORAGE_DIRECTORIES.pendingDelete, `${operationId}.json`);

export const getWorkerHeartbeatPath = () =>
  resolveWithinRoot(STORAGE_DIRECTORIES.tmp, "worker-heartbeat.json");

export const ensureUserCommittedStorageDirectories = async (
  username: string,
) => {
  await Promise.all([
    mkdir(resolveWithinRoot(getUserLibraryRootStorageKey(username)), {
      recursive: true,
    }),
    mkdir(resolveWithinRoot(getUserTrashRootStorageKey(username)), {
      recursive: true,
    }),
  ]);
};

export const ensureStorageDirectories = async () => {
  await Promise.all(
    Object.values(STORAGE_DIRECTORIES).map((directory) =>
      mkdir(resolveWithinRoot(directory), { recursive: true }),
    ),
  );
};
