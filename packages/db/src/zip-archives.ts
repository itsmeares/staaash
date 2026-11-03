import { getPrisma } from "./client";
import { scheduleZipArchiveGenerate } from "./jobs";

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
  storageRevision: number;
};

type ZipArchiveClient = {
  zipArchive: {
    findUnique(args: object): Promise<ZipArchiveRecord | null>;
    findMany(args: object): Promise<ZipArchiveRecord[]>;
    update(args: object): Promise<ZipArchiveRecord>;
  };
};

const getClient = () => getPrisma() as unknown as ZipArchiveClient;

export const findOrCreateZipArchive = async ({
  userId,
  contentKey,
  idsJson,
  expiresAt,
  sourceSizeBytes,
}: {
  userId: string;
  contentKey: string;
  idsJson: { fileIds: string[]; folderIds: string[] };
  expiresAt: Date;
  sourceSizeBytes: bigint;
}): Promise<{ archive: ZipArchiveRecord; created: boolean }> => {
  return getPrisma().$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${contentKey}, 0))`;
    const existing = await db.zipArchive.findUnique({ where: { contentKey } });
    if (existing) {
      if (
        existing.status === ZIP_ARCHIVE_STATUS_QUEUED ||
        existing.status === ZIP_ARCHIVE_STATUS_PROCESSING ||
        (existing.status === ZIP_ARCHIVE_STATUS_READY &&
          existing.expiresAt > new Date())
      ) {
        if (existing.status === ZIP_ARCHIVE_STATUS_QUEUED) {
          await scheduleZipArchiveGenerate({
            archiveId: existing.id,
            sourceSizeBytes,
            fileCount: idsJson.fileIds.length,
            folderCount: idsJson.folderIds.length,
            transaction: db,
          });
        }
        return { archive: existing, created: false };
      }
      // Keep old downloads and journal cleanup attached to their original record.
      await db.zipArchive.update({
        where: { id: existing.id },
        data: { contentKey: `${contentKey}:retired:${existing.id}` },
      });
    }
    const archive = await db.zipArchive.create({
      data: {
        userId,
        contentKey,
        idsJson,
        expiresAt,
        status: ZIP_ARCHIVE_STATUS_QUEUED,
      },
    });
    await scheduleZipArchiveGenerate({
      archiveId: archive.id,
      sourceSizeBytes,
      fileCount: idsJson.fileIds.length,
      folderCount: idsJson.folderIds.length,
      transaction: db,
    });
    return { archive, created: true };
  });
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
