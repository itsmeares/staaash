import type { FileTextSource } from "@staaash/config/text";

import { Prisma, getPrisma } from "./client";
import type { FileTextStatus } from "./generated/prisma/client";
import { FILE_TEXT_READ_JOB_KIND, ensureBackgroundJobScheduled } from "./jobs";

export const FILE_TEXT_CHANGED_CHANNEL = "staaash_file_text_changed";
/** Text kept per file. Search and the AI read tool see no more than this. */
export const FILE_TEXT_MAX_BYTES = 1024 * 1024;
/** Larger PDFs, Office files, books, and pictures are not read. */
export const FILE_TEXT_MAX_READ_BYTES = 100 * 1024 * 1024;
export const FILE_TEXT_READ_MAX_ATTEMPTS = 3;

/** Text counts only while it came from the file's present bytes. */
export const fileTextIsCurrent = (text: string, file: string) =>
  Prisma.sql`${Prisma.raw(text)}."sourceChecksum" IS NOT DISTINCT FROM ${Prisma.raw(file)}."contentChecksum" AND ${Prisma.raw(text)}."sourceSize" = ${Prisma.raw(file)}."sizeBytes"`;

const liveFile = (file: string) =>
  Prisma.sql`${Prisma.raw(file)}."deletedAt" IS NULL AND ${Prisma.raw(file)}."storageStatus" = 'available'`;

/** Starts the reader now. It reads every file that has no current text. */
export const scheduleFileTextRead = (now = new Date()) =>
  ensureBackgroundJobScheduled({
    kind: FILE_TEXT_READ_JOB_KIND,
    runAt: now,
    windowEnd: now,
    maxAttempts: FILE_TEXT_READ_MAX_ATTEMPTS,
    now,
  });

const notifyFileText = (fileId: string) =>
  getPrisma()
    .$executeRaw`SELECT pg_notify(${FILE_TEXT_CHANGED_CHANNEL}, ${fileId})`;

export type FileTextRecord = {
  status: FileTextStatus;
  source: FileTextSource | null;
  text: string;
  truncated: boolean;
  ocrPages: number[];
  ocrDone: number;
  ocrLanguages: string[];
  error: string | null;
  current: boolean;
};

export const findFileText = async (fileId: string) => {
  const [row] = await getPrisma().$queryRaw<FileTextRecord[]>`
    SELECT t.status, t.source, t.text, t.truncated, COALESCE(t."ocrPages", '{}') AS "ocrPages",
      t."ocrDone", COALESCE(t."ocrLanguages", '{}') AS "ocrLanguages", t.error,
      (${fileTextIsCurrent("t", "f")}) IS TRUE AS current
    FROM "FileText" t JOIN "File" f ON f.id = t."fileId"
    WHERE t."fileId" = ${fileId}`;
  return row ?? null;
};

/** Puts the file at the front of the reader's queue and starts it. */
export const wantFileText = async (fileId: string, ownerUserId: string) => {
  await getPrisma().$executeRaw`
    INSERT INTO "FileText" ("fileId", "ownerUserId", status, "wantedAt")
    VALUES (${fileId}, ${ownerUserId}, 'pending', now())
    ON CONFLICT ("fileId") DO UPDATE SET "wantedAt" = now()`;
  await scheduleFileTextRead();
};

export type FileToRead = {
  id: string;
  ownerUserId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  contentChecksum: string | null;
  storageKey: string;
  wanted: boolean;
};

/**
 * Live files with no current text, wanted ones first, then newest. A PDF
 * skipped for want of a PDF reader comes back once there is one.
 */
export const listFilesToRead = ({
  limit,
  skip,
  pdfReader,
}: {
  limit: number;
  skip: string[];
  pdfReader: boolean;
}) =>
  getPrisma().$queryRaw<FileToRead[]>`
    SELECT f.id, f."ownerUserId", f."originalName", f."mimeType", f."sizeBytes",
      f."contentChecksum", f."storageKey", t."wantedAt" IS NOT NULL AS wanted
    FROM "File" f LEFT JOIN "FileText" t ON t."fileId" = f.id
    WHERE ${liveFile("f")} AND NOT f.id = ANY(${skip}::text[])
      AND (t."fileId" IS NULL OR t.status = 'pending' OR (${fileTextIsCurrent("t", "f")}) IS NOT TRUE
        OR (${pdfReader} AND t.error = 'no-pdf-reader'))
    ORDER BY t."wantedAt" DESC NULLS LAST, f."updatedAt" DESC, f.id
    LIMIT ${limit}`;

export type FileToScan = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: bigint;
  contentChecksum: string | null;
  storageKey: string;
  source: FileTextSource;
  text: string;
  ocrPages: number[];
  ocrDone: number;
  ocrLanguages: string[];
  wanted: boolean;
};

/**
 * The next file with pages left to scan, or scanned in other languages than
 * the ones chosen now.
 */
export const findFileToScan = async ({
  sources,
  languages,
  skip,
}: {
  sources: FileTextSource[];
  languages: string[];
  skip: string[];
}) => {
  if (sources.length === 0 || languages.length === 0) return null;
  const [row] = await getPrisma().$queryRaw<FileToScan[]>`
    SELECT f.id, f."originalName", f."mimeType", f."sizeBytes", f."contentChecksum", f."storageKey",
      t.source, t.text, t."ocrPages", t."ocrDone", COALESCE(t."ocrLanguages", '{}') AS "ocrLanguages",
      t."wantedAt" IS NOT NULL AS wanted
    FROM "FileText" t JOIN "File" f ON f.id = t."fileId"
    WHERE t.status = 'ready' AND cardinality(t."ocrPages") > 0 AND t.source = ANY(${sources}::text[])
      AND (t."ocrDone" < cardinality(t."ocrPages") OR COALESCE(t."ocrLanguages", '{}') <> ${languages}::text[])
      AND ${fileTextIsCurrent("t", "f")} AND ${liveFile("f")} AND NOT f.id = ANY(${skip}::text[])
    ORDER BY t."wantedAt" DESC NULLS LAST, f."updatedAt" DESC, f.id
    LIMIT 1`;
  return row ?? null;
};

export type FileTextResult = {
  status: Exclude<FileTextStatus, "pending">;
  source: FileTextSource | null;
  text?: string;
  truncated?: boolean;
  ocrPages?: number[];
  error?: string | null;
  /** Done with this file, so nobody waits for it any more. */
  finished: boolean;
};

/** Saves what the fast pass read, for the bytes the file had when it began. */
export const saveFileText = async (
  file: Pick<
    FileToRead,
    "id" | "ownerUserId" | "contentChecksum" | "sizeBytes"
  >,
  result: FileTextResult,
) => {
  const data = {
    sourceChecksum: file.contentChecksum,
    sourceSize: file.sizeBytes,
    status: result.status,
    source: result.source,
    text: result.text ?? "",
    truncated: result.truncated ?? false,
    ocrPages: result.ocrPages ?? [],
    ocrDone: 0,
    ocrLanguages: [],
    error: result.error ?? null,
    readAt: new Date(),
    ...(result.finished ? { wantedAt: null } : {}),
  };
  await getPrisma().fileText.upsert({
    where: { fileId: file.id },
    create: { fileId: file.id, ownerUserId: file.ownerUserId, ...data },
    update: data,
  });
  await notifyFileText(file.id);
};

/**
 * Saves one scanned page. Nothing is saved when the file changed since the
 * scan began; the reader starts over on the new bytes.
 */
export const saveScannedPage = async (
  file: Pick<FileToScan, "id" | "contentChecksum" | "sizeBytes">,
  update: {
    text: string;
    truncated: boolean;
    ocrPages: number[];
    ocrDone: number;
    ocrLanguages: string[];
    status?: "failed";
    error?: string;
    finished: boolean;
  },
) => {
  const { finished, truncated, ...data } = update;
  await getPrisma().fileText.updateMany({
    where: {
      fileId: file.id,
      sourceChecksum: file.contentChecksum,
      sourceSize: file.sizeBytes,
    },
    data: {
      ...data,
      // Text cut by the first read stays cut, whatever a page adds.
      ...(truncated ? { truncated: true } : {}),
      readAt: new Date(),
      ...(finished ? { wantedAt: null } : {}),
    },
  });
  await notifyFileText(file.id);
};

export type FileTextSummary = {
  read: number;
  waiting: number;
  failed: number;
  pagesWaiting: number;
};

/** Counts for the admin page. Pages waiting only counts what OCR will read. */
export const getFileTextSummary = async ({
  sources,
  languages,
}: {
  sources: FileTextSource[];
  languages: string[];
}): Promise<FileTextSummary> => {
  const [row] = await getPrisma().$queryRaw<
    { read: bigint; waiting: bigint; failed: bigint; pages: bigint | null }[]
  >`
    SELECT
      count(*) FILTER (WHERE current AND t.status IN ('ready', 'skipped')) AS read,
      count(*) FILTER (WHERE current IS NOT TRUE OR t.status = 'pending') AS waiting,
      count(*) FILTER (WHERE current AND t.status = 'failed') AS failed,
      sum(CASE WHEN COALESCE(t."ocrLanguages", '{}') = ${languages}::text[]
        THEN cardinality(t."ocrPages") - t."ocrDone" ELSE cardinality(t."ocrPages") END)
        FILTER (WHERE current AND t.status = 'ready' AND t.source = ANY(${sources}::text[])) AS pages
    FROM "File" f
    LEFT JOIN "FileText" t ON t."fileId" = f.id
    CROSS JOIN LATERAL (SELECT (${fileTextIsCurrent("t", "f")}) IS TRUE AS current) c
    WHERE ${liveFile("f")}`;
  return {
    read: Number(row?.read ?? 0),
    waiting: Number(row?.waiting ?? 0),
    failed: Number(row?.failed ?? 0),
    pagesWaiting: Number(row?.pages ?? 0),
  };
};
