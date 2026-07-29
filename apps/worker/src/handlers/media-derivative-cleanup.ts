// Generated-artifact cleanup handlers intentionally share journaled purge flow.
// fallow-ignore-file code-duplication
import { getPrisma } from "@staaash/db/client";
import { lstat } from "node:fs/promises";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  DERIVATIVE_STATUS_PROCESSING,
  DERIVATIVE_STATUS_QUEUED,
  DERIVATIVE_STATUS_READY,
  markDerivativeStale,
} from "@staaash/db/media-derivatives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";
import {
  calculateStorageFileChecksum,
  resolveMutationStoragePath,
} from "@staaash/db/storage-mutation-executor";
import { runWorkerStorageMutation } from "../durable-storage-mutation.js";

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
  storageRevision: number;
  sizeBytes: bigint | null;
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
  ownerUserId: string;
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

const isFileProtectedByFolderShare = async (
  prisma: PrismaClient,
  fileId: string,
  now: Date,
): Promise<boolean> => {
  const file = await prisma.file.findUnique({
    where: { id: fileId },
    select: { id: true, ownerUserId: true, folderId: true } as object,
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

const latestDerivativeReference = (derivative: MediaDerivativeRecord) =>
  [
    derivative.lastViewedAt,
    derivative.lastSharedAt,
    derivative.generatedAt,
    derivative.updatedAt,
  ]
    .filter((date): date is Date => date !== null)
    .reduce((latest, date) => (date > latest ? date : latest), new Date(0));

const hasDirectShare = async (
  prisma: PrismaClient,
  derivative: MediaDerivativeRecord,
  now: Date,
) =>
  prisma.shareLink
    .findFirst({
      where: {
        fileId: derivative.fileId,
        revokedAt: null,
        expiresAt: { gt: now },
      } as object,
    })
    .then((share) => share !== null);

const hasActiveGeneration = async (
  prisma: PrismaClient,
  derivativeId: string,
) =>
  prisma.mediaDerivative
    .findMany({
      where: {
        id: derivativeId,
        status: {
          in: [DERIVATIVE_STATUS_QUEUED, DERIVATIVE_STATUS_PROCESSING],
        },
      } as object,
    })
    .then((rows) => rows.length > 0);

const purgeDerivative = async ({
  prisma,
  derivative,
  storagePaths,
}: {
  prisma: PrismaClient;
  derivative: MediaDerivativeRecord & { storageKey: string };
  storagePaths: WorkerStoragePaths;
}) => {
  const file = await prisma.file.findUnique({
    where: { id: derivative.fileId },
    select: { id: true, ownerUserId: true, folderId: true } as object,
  });
  if (!file) return;
  const checksum = await calculateChecksumIfPresent(
    storagePaths.filesRoot,
    derivative.storageKey,
  );
  await runWorkerStorageMutation({
    mutationId: `derivative-purge-${derivative.id}-${derivative.storageRevision}`,
    kind: "derivative_purge",
    ownerUserId: file.ownerUserId,
    idempotencyKey: `derivative-purge:${derivative.id}:${derivative.storageRevision}`,
    storagePaths,
    metadataOperations: [
      {
        action: "update",
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
        data: { status: "stale", storageKey: null, sizeBytes: null },
      },
    ],
    steps: [
      {
        action: "delete_file",
        targetKey: derivative.storageKey,
        expectedNodeType: "file",
        expectedSizeBytes: derivative.sizeBytes,
        expectedChecksum: checksum,
      },
    ],
    entities: [
      {
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision,
        postRevision: derivative.storageRevision + 1,
        beforeJson: { storageKey: derivative.storageKey },
        afterJson: { status: "stale" },
      },
    ],
  });
};

const processDerivativeCandidate = async ({
  prisma,
  derivative,
  now,
  retentionCutoff,
  storagePaths,
}: {
  prisma: PrismaClient;
  derivative: MediaDerivativeRecord;
  now: Date;
  retentionCutoff: Date;
  storagePaths: WorkerStoragePaths;
}) => {
  if (derivative.pinnedByAdmin) return;
  if (latestDerivativeReference(derivative) >= retentionCutoff) return;
  if (await hasDirectShare(prisma, derivative, now)) return;
  if (await isFileProtectedByFolderShare(prisma, derivative.fileId, now))
    return;
  if (await hasActiveGeneration(prisma, derivative.id)) return;
  if (!derivative.storageKey) return;
  await purgeDerivative({
    prisma,
    derivative: { ...derivative, storageKey: derivative.storageKey },
    storagePaths,
  });
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
    await processDerivativeCandidate({
      prisma,
      now,
      retentionCutoff,
      derivative,
      storagePaths,
    });
  }
};
