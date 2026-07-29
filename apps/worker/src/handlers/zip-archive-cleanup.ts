import { getPrisma } from "@staaash/db/client";
import { lstat } from "node:fs/promises";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { findExpiredZipArchives } from "@staaash/db/zip-archives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";
import {
  calculateStorageFileChecksum,
  resolveMutationStoragePath,
} from "@staaash/db/storage-mutation-executor";
import { runWorkerStorageMutation } from "../durable-storage-mutation.js";

type SystemSettingsRecord = {
  zipArchiveRetentionDays: number;
};

type PrismaClient = {
  systemSettings: {
    findUnique(args: object): Promise<SystemSettingsRecord | null>;
  };
  zipArchive: {
    delete(args: object): Promise<void>;
  };
};

const DEFAULT_RETENTION_DAYS = 7;

const calculateChecksumIfPresent = async (
  filesRoot: string,
  storageKey: string,
) => {
  const target = resolveMutationStoragePath(filesRoot, storageKey);
  try {
    await lstat(target);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  return calculateStorageFileChecksum(filesRoot, storageKey);
};

export const handleZipArchiveCleanup = async (
  _job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  const prisma = getPrisma() as unknown as PrismaClient;
  const now = new Date();

  const rawSettings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { zipArchiveRetentionDays: true } as object,
  });

  const retentionDays =
    rawSettings?.zipArchiveRetentionDays ?? DEFAULT_RETENTION_DAYS;

  if (retentionDays === 0) {
    return;
  }

  const expired = await findExpiredZipArchives(now);

  for (const archive of expired) {
    if (!archive.storageKey) continue;
    const checksum = await calculateChecksumIfPresent(
      storagePaths.filesRoot,
      archive.storageKey,
    );
    await runWorkerStorageMutation({
      mutationId: `archive-purge-${archive.id}`,
      kind: "archive_purge",
      ownerUserId: archive.userId,
      idempotencyKey: `archive-purge:${archive.id}`,
      storagePaths,
      metadataOperations: [
        {
          action: "delete",
          entityType: "archive",
          entityId: archive.id,
          preRevision: archive.storageRevision,
        },
      ],
      steps: [
        {
          action: "delete_file",
          targetKey: archive.storageKey,
          expectedNodeType: "file",
          expectedSizeBytes: archive.sizeBytes,
          expectedChecksum: checksum,
        },
      ],
      entities: [
        {
          entityType: "archive",
          entityId: archive.id,
          preRevision: archive.storageRevision,
          postRevision: archive.storageRevision + 1,
          beforeJson: { storageKey: archive.storageKey },
          afterJson: null,
        },
      ],
    });
  }
};
