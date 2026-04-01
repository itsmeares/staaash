import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  open,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  getPendingDeleteBlobPath,
  getPendingDeleteDirectoryPath,
  getPendingDeleteManifestPath,
  getStorageLockDirectoryPath,
  getStorageLockPath,
} from "@/server/storage";

const DEFAULT_STORAGE_LOCK_TIMEOUT_MS = 1_500;
const STORAGE_LOCK_POLL_MS = 25;

export type PendingDeleteRecord = {
  operationId: string;
  fileId: string;
  originalStorageKey: string;
  originalPath: string;
  quarantineBlobPath: string;
  quarantineManifestPath: string;
  createdAt: string;
};

type StorageDeadline = Date | number | null | undefined;

type WithStorageLocksOptions<T> = {
  lockKeys: string[];
  deadline?: StorageDeadline;
  callback: () => Promise<T>;
};

type CommitStagedUploadWithLockOptions = {
  stagedPath: string;
  targetPath: string;
  lockKeys: string[];
  deadline?: StorageDeadline;
};

type ReplaceCommittedUploadWithLockOptions<T> = {
  stagedPath: string;
  targetPath: string;
  uploadId: string;
  lockKeys: string[];
  deadline?: StorageDeadline;
  applyMetadataUpdate: () => Promise<T>;
};

type MoveStorageEntryWithLockOptions = {
  fromPath: string;
  toPath: string;
  lockKeys: string[];
  deadline?: StorageDeadline;
};

type QuarantineDeleteWithLockOptions = {
  fileId: string;
  originalStorageKey: string;
  originalPath: string;
  lockKeys: string[];
  deadline?: StorageDeadline;
};

export type StorageMutationErrorCode =
  | "STORAGE_LOCK_TIMEOUT"
  | "STORAGE_TARGET_EXISTS"
  | "STORAGE_TARGET_MISSING";

const storageMutationStatuses: Record<StorageMutationErrorCode, number> = {
  STORAGE_LOCK_TIMEOUT: 409,
  STORAGE_TARGET_EXISTS: 409,
  STORAGE_TARGET_MISSING: 409,
};

const storageMutationMessages: Record<StorageMutationErrorCode, string> = {
  STORAGE_LOCK_TIMEOUT:
    "Another storage operation is already in progress for this item.",
  STORAGE_TARGET_EXISTS: "The destination storage path already exists.",
  STORAGE_TARGET_MISSING: "The source storage path no longer exists.",
};

export class StorageMutationError extends Error {
  readonly code: StorageMutationErrorCode;
  readonly status: number;

  constructor(
    code: StorageMutationErrorCode,
    message = storageMutationMessages[code],
  ) {
    super(message);
    this.name = "StorageMutationError";
    this.code = code;
    this.status = storageMutationStatuses[code];
  }
}

const normalizeDeadline = (deadline?: StorageDeadline) => {
  if (deadline === null || deadline === undefined) {
    return Date.now() + DEFAULT_STORAGE_LOCK_TIMEOUT_MS;
  }

  return deadline instanceof Date ? deadline.getTime() : deadline;
};

const hashLockKey = (lockKey: string) =>
  createHash("sha256").update(lockKey).digest("hex");

const ensureStorageLockDirectory = async () => {
  await mkdir(getStorageLockDirectoryPath(), { recursive: true });
};

const ensurePendingDeleteDirectory = async () => {
  await mkdir(getPendingDeleteDirectoryPath(), { recursive: true });
};

const assertPathMissing = async (targetPath: string) => {
  try {
    await access(targetPath, constants.F_OK);
    throw new StorageMutationError("STORAGE_TARGET_EXISTS");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }

    throw error;
  }
};

const assertPathPresent = async (targetPath: string) => {
  try {
    await access(targetPath, constants.F_OK);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StorageMutationError("STORAGE_TARGET_MISSING");
    }

    throw error;
  }
};

const acquireLock = async (
  lockKey: string,
  deadlineMs: number,
): Promise<{ handle: FileHandle; lockPath: string }> => {
  const lockPath = getStorageLockPath(hashLockKey(lockKey));

  while (Date.now() <= deadlineMs) {
    try {
      const handle = await open(lockPath, "wx");
      return {
        handle,
        lockPath,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      if (Date.now() + STORAGE_LOCK_POLL_MS > deadlineMs) {
        break;
      }

      await delay(STORAGE_LOCK_POLL_MS);
    }
  }

  throw new StorageMutationError("STORAGE_LOCK_TIMEOUT");
};

const releaseLocks = async (
  locks: Array<{ handle: FileHandle; lockPath: string }>,
) => {
  for (const lock of locks.reverse()) {
    try {
      await lock.handle.close();
    } finally {
      await rm(lock.lockPath, { force: true });
    }
  }
};

export const withStorageLocks = async <T>({
  lockKeys,
  deadline,
  callback,
}: WithStorageLocksOptions<T>) => {
  await ensureStorageLockDirectory();
  const deadlineMs = normalizeDeadline(deadline);
  const locks: Array<{ handle: FileHandle; lockPath: string }> = [];
  const uniqueLockKeys = Array.from(new Set(lockKeys)).sort((left, right) =>
    left.localeCompare(right),
  );

  try {
    for (const lockKey of uniqueLockKeys) {
      locks.push(await acquireLock(lockKey, deadlineMs));
    }

    return await callback();
  } finally {
    await releaseLocks(locks);
  }
};

export const getDirectoryMutationLockKey = (storagePath: string) =>
  `dir:${path.dirname(storagePath)}`;

export const getEntryMutationLockKey = (storagePath: string) =>
  `entry:${storagePath}`;

export const commitStagedUploadWithLock = async ({
  stagedPath,
  targetPath,
  lockKeys,
  deadline,
}: CommitStagedUploadWithLockOptions) =>
  withStorageLocks({
    lockKeys,
    deadline,
    callback: async () => {
      await assertPathMissing(targetPath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await rename(stagedPath, targetPath);
    },
  });

export const replaceCommittedUploadWithLock = async <T>({
  stagedPath,
  targetPath,
  uploadId,
  lockKeys,
  deadline,
  applyMetadataUpdate,
}: ReplaceCommittedUploadWithLockOptions<T>) =>
  withStorageLocks({
    lockKeys,
    deadline,
    callback: async () => {
      const backupPath = `${targetPath}.backup-${uploadId}`;

      await mkdir(path.dirname(targetPath), { recursive: true });
      await assertPathPresent(targetPath);

      try {
        await rename(targetPath, backupPath);
        await rename(stagedPath, targetPath);
      } catch (error) {
        await rm(stagedPath, { force: true });

        try {
          await rename(backupPath, targetPath);
        } catch {
          // Preserve the original error.
        }

        throw error;
      }

      try {
        const result = await applyMetadataUpdate();
        await rm(backupPath, { force: true });
        return result;
      } catch (error) {
        try {
          await rm(targetPath, { force: true });
          await rename(backupPath, targetPath);
        } catch {
          // Preserve the original application error.
        }

        throw error;
      }
    },
  });

export const moveStorageEntryWithLock = async ({
  fromPath,
  toPath,
  lockKeys,
  deadline,
}: MoveStorageEntryWithLockOptions) =>
  withStorageLocks({
    lockKeys,
    deadline,
    callback: async () => {
      if (fromPath === toPath) {
        return;
      }

      await assertPathPresent(fromPath);
      await assertPathMissing(toPath);
      await mkdir(path.dirname(toPath), { recursive: true });
      await rename(fromPath, toPath);
    },
  });

export const quarantineDeleteWithLock = async ({
  fileId,
  originalStorageKey,
  originalPath,
  lockKeys,
  deadline,
}: QuarantineDeleteWithLockOptions): Promise<PendingDeleteRecord> =>
  withStorageLocks({
    lockKeys,
    deadline,
    callback: async () => {
      await ensurePendingDeleteDirectory();
      await assertPathPresent(originalPath);

      const operationId = randomUUID();
      const quarantineBlobPath = getPendingDeleteBlobPath(operationId);
      const quarantineManifestPath = getPendingDeleteManifestPath(operationId);
      const record: PendingDeleteRecord = {
        operationId,
        fileId,
        originalStorageKey,
        originalPath,
        quarantineBlobPath,
        quarantineManifestPath,
        createdAt: new Date().toISOString(),
      };

      try {
        await rename(originalPath, quarantineBlobPath);
        await writeFile(
          quarantineManifestPath,
          JSON.stringify(record, null, 2),
          "utf8",
        );
        return record;
      } catch (error) {
        try {
          await rename(quarantineBlobPath, originalPath);
        } catch {
          // Preserve the original error.
        }

        await rm(quarantineManifestPath, { force: true });
        throw error;
      }
    },
  });

export const rollbackPendingDelete = async (record: PendingDeleteRecord) => {
  await mkdir(path.dirname(record.originalPath), { recursive: true });

  if (record.quarantineBlobPath !== record.originalPath) {
    await rename(record.quarantineBlobPath, record.originalPath);
  }

  await rm(record.quarantineManifestPath, { force: true });
};

export const finalizePendingDelete = async (record: PendingDeleteRecord) => {
  await rm(record.quarantineBlobPath, { force: true });
  await rm(record.quarantineManifestPath, { force: true });
};
