import { rm } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { findExpiredZipArchives } from "@staaash/db/zip-archives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";

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
    if (archive.storageKey) {
      const filePath = safeResolveStoragePath(
        storagePaths.filesRoot,
        archive.storageKey,
      );
      await rm(filePath, { force: true });
    }

    await prisma.zipArchive.delete({
      where: { id: archive.id } as object,
    });
  }
};
