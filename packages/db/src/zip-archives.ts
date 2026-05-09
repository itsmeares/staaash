import { createHash } from "node:crypto";

import { getPrisma } from "./client";

export const ZIP_ARCHIVE_STATUS_QUEUED = "queued" as const;
export const ZIP_ARCHIVE_STATUS_PROCESSING = "processing" as const;
export const ZIP_ARCHIVE_STATUS_READY = "ready" as const;
export const ZIP_ARCHIVE_STATUS_FAILED = "failed" as const;

export type ZipArchiveRecord = {
  id: string;
  userId: string;
  contentKey: string;
  idsJson: unknown;
  status: string;
  storageKey: string | null;
  fileName: string | null;
  sizeBytes: bigint | null;
  fileCount: number | null;
  error: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

type ZipArchiveClient = {
  zipArchive: {
    findFirst(args: object): Promise<ZipArchiveRecord | null>;
    findUnique(args: object): Promise<ZipArchiveRecord | null>;
    findMany(args: object): Promise<ZipArchiveRecord[]>;
    create(args: object): Promise<ZipArchiveRecord>;
    update(args: object): Promise<ZipArchiveRecord>;
    delete(args: object): Promise<ZipArchiveRecord>;
  };
};

const getClient = () => getPrisma() as unknown as ZipArchiveClient;

export const buildZipContentKey = (
  fileIds: string[],
  folderIds: string[],
): string => {
  const sorted =
    [...fileIds].sort().join(",") + "|" + [...folderIds].sort().join(",");
  return createHash("sha256").update(sorted).digest("hex");
};

export const findOrCreateZipArchive = async ({
  userId,
  contentKey,
  idsJson,
  expiresAt,
}: {
  userId: string;
  contentKey: string;
  idsJson: { fileIds: string[]; folderIds: string[] };
  expiresAt: Date;
}): Promise<{ archive: ZipArchiveRecord; created: boolean }> => {
  const db = getClient();
  const now = new Date();

  const existing = await db.zipArchive.findFirst({
    where: {
      contentKey,
      status: { not: ZIP_ARCHIVE_STATUS_FAILED },
      expiresAt: { gt: now },
    },
  });

  if (existing) {
    return { archive: existing, created: false };
  }

  const archive = await db.zipArchive.create({
    data: {
      userId,
      contentKey,
      idsJson,
      status: ZIP_ARCHIVE_STATUS_QUEUED,
      expiresAt,
    },
  });

  return { archive, created: true };
};

export const updateZipArchiveProcessing = async (
  archiveId: string,
): Promise<void> => {
  await getClient().zipArchive.update({
    where: { id: archiveId },
    data: { status: ZIP_ARCHIVE_STATUS_PROCESSING },
  });
};

export const updateZipArchiveReady = async (
  archiveId: string,
  storageKey: string,
  fileName: string,
  sizeBytes: bigint,
  fileCount: number,
): Promise<void> => {
  await getClient().zipArchive.update({
    where: { id: archiveId },
    data: {
      status: ZIP_ARCHIVE_STATUS_READY,
      storageKey,
      fileName,
      sizeBytes,
      fileCount,
      error: null,
    },
  });
};

export const updateZipArchiveFailed = async (
  archiveId: string,
  error: string,
): Promise<void> => {
  await getClient().zipArchive.update({
    where: { id: archiveId },
    data: { status: ZIP_ARCHIVE_STATUS_FAILED, error: error.slice(0, 2000) },
  });
};

export const findZipArchiveById = async (
  archiveId: string,
): Promise<ZipArchiveRecord | null> => {
  return getClient().zipArchive.findUnique({ where: { id: archiveId } });
};

export const findExpiredZipArchives = async (
  now = new Date(),
): Promise<ZipArchiveRecord[]> => {
  return getClient().zipArchive.findMany({
    where: {
      expiresAt: { lte: now },
      storageKey: { not: null },
    },
  });
};
