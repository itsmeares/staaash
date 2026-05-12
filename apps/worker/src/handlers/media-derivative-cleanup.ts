import { rm } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  DERIVATIVE_STATUS_PROCESSING,
  DERIVATIVE_STATUS_QUEUED,
  DERIVATIVE_STATUS_READY,
  markDerivativeStale,
} from "@staaash/db/media-derivatives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";

type MediaDerivativeRecord = {
  id: string;
  fileId: string;
  status: string;
  storageKey: string | null;
  pinnedByAdmin: boolean;
  lastViewedAt: Date | null;
  lastSharedAt: Date | null;
  generatedAt: Date | null;
  updatedAt: Date;
};

type FolderRecord = {
  id: string;
  parentId: string | null;
};

type ShareLinkRecord = {
  id: string;
};

type FileRecord = {
  id: string;
  folderId: string | null;
};

type SystemSettingsRecord = {
  mediaPreviewRetentionDays: number;
};

type PrismaClient = {
  mediaDerivative: {
    findMany(args: object): Promise<MediaDerivativeRecord[]>;
  };
  shareLink: {
    findFirst(args: object): Promise<ShareLinkRecord | null>;
  };
  folder: {
    findUnique(args: object): Promise<FolderRecord | null>;
  };
  file: {
    findUnique(args: object): Promise<FileRecord | null>;
  };
  systemSettings: {
    findUnique(args: object): Promise<SystemSettingsRecord | null>;
  };
};

const DEFAULT_RETENTION_DAYS = 14;

const isFileProtectedByFolderShare = async (
  prisma: PrismaClient,
  fileId: string,
  now: Date,
): Promise<boolean> => {
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, folderId: true } as object,
  });

  if (!file?.folderId) return false;

  let folderId: string | null = file.folderId;

  while (folderId) {
    const activeShare = await prisma.shareLink.findFirst({
      where: {
        folderId,
        revokedAt: null,
        expiresAt: { gt: now },
      } as object,
    });

    if (activeShare) return true;

    const folder = await prisma.folder.findUnique({
      where: { id: folderId },
      select: { id: true, parentId: true } as object,
    });

    folderId = folder?.parentId ?? null;
  }

  return false;
};

export const handleMediaDerivativeCleanup = async (
  _job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  const prisma = getPrisma() as unknown as PrismaClient;
  const now = new Date();

  const rawSettings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: { mediaPreviewRetentionDays: true } as object,
  });

  const retentionDays =
    rawSettings?.mediaPreviewRetentionDays ?? DEFAULT_RETENTION_DAYS;

  if (retentionDays === 0) {
    return;
  }

  const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
  const retentionCutoff = new Date(now.getTime() - retentionMs);

  const candidates = await prisma.mediaDerivative.findMany({
    where: {
      status: DERIVATIVE_STATUS_READY,
      pinnedByAdmin: false,
      storageKey: { not: null },
    } as object,
  });

  for (const derivative of candidates) {
    if (derivative.pinnedByAdmin) continue;

    const referenceDate = [
      derivative.lastViewedAt,
      derivative.lastSharedAt,
      derivative.generatedAt,
      derivative.updatedAt,
    ]
      .filter((d): d is Date => d !== null)
      .reduce((latest, d) => (d > latest ? d : latest), new Date(0));

    if (referenceDate >= retentionCutoff) continue;

    const isDirectlyShared = await prisma.shareLink
      .findFirst({
        where: {
          fileId: derivative.fileId,
          revokedAt: null,
          expiresAt: { gt: now },
        } as object,
      })
      .then((r) => r !== null);

    if (isDirectlyShared) continue;

    const isFolderShared = await isFileProtectedByFolderShare(
      prisma,
      derivative.fileId,
      now,
    );

    if (isFolderShared) continue;

    const activeJobStatus = await prisma.mediaDerivative
      .findMany({
        where: {
          id: derivative.id,
          status: {
            in: [DERIVATIVE_STATUS_QUEUED, DERIVATIVE_STATUS_PROCESSING],
          },
        } as object,
      })
      .then((rows) => rows.length > 0);

    if (activeJobStatus) continue;

    if (derivative.storageKey) {
      const filePath = safeResolveStoragePath(
        storagePaths.filesRoot,
        derivative.storageKey,
      );
      await rm(filePath, { force: true });
    }

    await markDerivativeStale(derivative.id);
  }
};
