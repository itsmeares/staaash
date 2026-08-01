import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { findExpiredZipArchives } from "@staaash/db/zip-archives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import {
  calculateStorageChecksumIfPresent,
  runWorkerStorageMutation,
} from "../durable-storage-mutation.js";

type SystemSettingsRecord = {
  zipArchiveRetentionDays: number;
};

type PrismaClient = {
  systemSettings: {
    findUnique(args: object): Promise<SystemSettingsRecord | null>;
  };
};

const DEFAULT_RETENTION_DAYS = 7;

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
    const checksum = archive.storageKey
      ? await calculateStorageChecksumIfPresent(
          storagePaths.filesRoot,
          archive.storageKey,
        )
      : undefined;
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
      steps: archive.storageKey
        ? [
            {
              action: "delete_file",
              targetKey: archive.storageKey,
              expectedNodeType: "file",
              expectedSizeBytes: archive.sizeBytes,
              expectedChecksum: checksum,
            },
          ]
        : [],
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
