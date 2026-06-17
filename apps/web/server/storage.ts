import path from "node:path";
import { mkdir } from "node:fs/promises";

import { env } from "@/lib/env";

const STORAGE_DIRECTORIES = {
  files: "files",
  trash: ".trash",
  tmp: "tmp",
  locks: "tmp/locks",
  pendingDelete: "tmp/pending-delete",
  derivatives: "derivatives",
  derivativesTmp: "tmp/derivatives",
} as const;

const resolveWithinRoot = (...segments: string[]) => {
  const root = path.resolve(env.UPLOAD_LOCATION);
  const resolved = path.resolve(root, ...segments);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Resolved path escaped the configured file root.");
  }

  return resolved;
};

export const getStorageRoot = () => path.resolve(env.UPLOAD_LOCATION);

export const getStoragePath = (storageKey: string) =>
  resolveWithinRoot(storageKey);

const getTmpRootPath = () => resolveWithinRoot(STORAGE_DIRECTORIES.tmp);

export const getStorageLockDirectoryPath = () =>
  resolveWithinRoot(STORAGE_DIRECTORIES.locks);

export const getPendingDeleteDirectoryPath = () =>
  resolveWithinRoot(STORAGE_DIRECTORIES.pendingDelete);

export const getUserFilesRootStorageKey = (storageId: string) =>
  path.posix.join(STORAGE_DIRECTORIES.files, storageId);

export const getUserTrashRootStorageKey = (storageId: string) =>
  path.posix.join(STORAGE_DIRECTORIES.trash, storageId);

const buildCommittedStorageKey = ({
  storageId,
  folderPathSegments,
  fileName,
  trashed,
}: {
  storageId: string;
  folderPathSegments: string[];
  fileName: string;
  trashed: boolean;
}) =>
  path.posix.join(
    trashed
      ? getUserTrashRootStorageKey(storageId)
      : getUserFilesRootStorageKey(storageId),
    ...folderPathSegments,
    fileName,
  );

export const getActiveCommittedStorageKey = ({
  storageId,
  folderPathSegments,
  fileName,
}: {
  storageId: string;
  folderPathSegments: string[];
  fileName: string;
}) =>
  buildCommittedStorageKey({
    storageId,
    folderPathSegments,
    fileName,
    trashed: false,
  });

export const getTrashedCommittedStorageKey = ({
  storageId,
  folderPathSegments,
  fileName,
}: {
  storageId: string;
  folderPathSegments: string[];
  fileName: string;
}) =>
  buildCommittedStorageKey({
    storageId,
    folderPathSegments,
    fileName,
    trashed: true,
  });

export const getActiveFolderStorageKey = ({
  storageId,
  folderPathSegments,
}: {
  storageId: string;
  folderPathSegments: string[];
}) =>
  path.posix.join(getUserFilesRootStorageKey(storageId), ...folderPathSegments);

export const getTrashedFolderStorageKey = ({
  storageId,
  folderPathSegments,
}: {
  storageId: string;
  folderPathSegments: string[];
}) =>
  path.posix.join(getUserTrashRootStorageKey(storageId), ...folderPathSegments);

const getDerivativePath = (storageKey: string) => resolveWithinRoot(storageKey);

const getDerivativeTmpPath = (derivativeId: string) =>
  resolveWithinRoot(
    STORAGE_DIRECTORIES.derivativesTmp,
    `${derivativeId}.mp4.tmp`,
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
  storageId: string,
) => {
  await Promise.all([
    mkdir(resolveWithinRoot(getUserFilesRootStorageKey(storageId)), {
      recursive: true,
    }),
    mkdir(resolveWithinRoot(getUserTrashRootStorageKey(storageId)), {
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
