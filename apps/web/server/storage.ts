import path from "node:path";
import { mkdir } from "node:fs/promises";

import { env } from "@/lib/env";
import type { StoredFileRef } from "@/server/types";

export const STORAGE_DIRECTORIES = {
  originals: "originals",
  previews: "previews",
  tmp: "tmp",
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

export const getOriginalStorageKey = (ownerUserId: string, fileId: string) =>
  path.posix.join(STORAGE_DIRECTORIES.originals, ownerUserId, fileId, "source");

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

export const getWorkerHeartbeatPath = () =>
  resolveWithinRoot(STORAGE_DIRECTORIES.tmp, "worker-heartbeat.json");

export const buildStoredFileRef = (
  ownerUserId: string,
  fileId: string,
): StoredFileRef => ({
  ownerUserId,
  fileId,
  storageKey: getOriginalStorageKey(ownerUserId, fileId),
});

export const ensureStorageDirectories = async () => {
  await Promise.all(
    Object.values(STORAGE_DIRECTORIES).map((directory) =>
      mkdir(resolveWithinRoot(directory), { recursive: true }),
    ),
  );
};
