import os from "node:os";

import { OCR_MODES, automaticOcrMode, scanPlan } from "@staaash/config/ocr";
import { textSourceOf, type FileTextSource } from "@staaash/config/text";
import { getPrisma } from "@staaash/db/client";
import {
  FILE_TEXT_MAX_READ_BYTES,
  findFileToScan,
  listFilesToRead,
  saveFileText,
  saveScannedPage,
  type FileToRead,
  type FileToScan,
} from "@staaash/db/file-text";
import { findBlockingStorageMutationForEntity } from "@staaash/db/storage-mutations";

import type { JobContext } from "../job-context.js";
import {
  safeResolveStoragePath,
  type WorkerStoragePaths,
} from "../storage-maintenance.js";
import {
  UnreadableFileError,
  getTextTools,
  limitText,
  placePage,
  readPdfText,
  readText,
  scanPdfPage,
  scanPicture,
  type ReadResult,
} from "../text/read.js";

const FILE_TEXT_EVERY_MS = 10 * 60_000;
const BATCH = 50;
/** A run stops after this and the next one starts at once. */
const RUN_MS = 15 * 60_000;
const READ_TIMEOUT_MS = 60_000;
const SCAN_TIMEOUT_MS = 2 * 60_000;

let continueNow = false;

/** Right away when the last run stopped with work left, else in a while. */
export const nextFileTextRunAt = async (now: Date) =>
  continueNow ? now : new Date(now.getTime() + FILE_TEXT_EVERY_MS);

/** What to scan and in which languages, from the owner's settings now. */
const readScanPlan = async () => {
  const settings = await getPrisma().systemSettings.findUnique({
    where: { id: "singleton" },
    select: { ocrMode: true, ocrLanguages: true },
  });
  const saved = OCR_MODES.find((mode) => mode === settings?.ocrMode);
  return scanPlan(
    saved ?? automaticOcrMode(os.availableParallelism()),
    [...(settings?.ocrLanguages ?? ["eng"])].sort(),
    getTextTools(),
  );
};

const isMissingFile = (error: unknown) =>
  ["ENOENT", "ENOTDIR", "EACCES", "EBUSY"].includes(
    (error as NodeJS.ErrnoException).code ?? "",
  );

const isTimeout = (error: unknown) =>
  error instanceof DOMException && error.name === "TimeoutError";

/** Why a file is not read at all, or null to read it. */
const skipReason = (file: FileToRead, source: FileTextSource | null) => {
  if (!source) return "not-text";
  if (source !== "text" && file.sizeBytes > FILE_TEXT_MAX_READ_BYTES) {
    return "too-large";
  }
  return source === "pdf" && !getTextTools().pdftotext ? "no-pdf-reader" : null;
};

// A rename or move in progress may take the file from under the reader.
const isBlocked = async (fileId: string) =>
  Boolean(
    await findBlockingStorageMutationForEntity({
      entityType: "file",
      entityId: fileId,
    }),
  );

const errorCode = (error: unknown) =>
  error instanceof UnreadableFileError
    ? error.code
    : isTimeout(error)
      ? "timeout"
      : "unreadable";

const readSource = async (
  filePath: string,
  source: FileTextSource,
  name: string,
  signal: AbortSignal,
): Promise<ReadResult> => {
  if (source === "pdf") return readPdfText(filePath, signal);
  // Pictures have no text until OCR reads them.
  if (source === "image") return { text: "", truncated: false, ocrPages: [1] };
  return readText(filePath, source, name);
};

const readOne = async (
  file: FileToRead,
  storagePaths: WorkerStoragePaths,
  signal: AbortSignal,
  scanSources: FileTextSource[],
): Promise<"read" | "skip"> => {
  const source = textSourceOf({
    name: file.originalName,
    mimeType: file.mimeType,
  });
  const reason = skipReason(file, source);
  if (reason || !source) {
    await saveFileText(file, {
      status: "skipped",
      source,
      error: reason,
      finished: true,
    });
    return "read";
  }
  if (await isBlocked(file.id)) return "skip";
  let result: ReadResult;
  try {
    result = await readSource(
      safeResolveStoragePath(storagePaths.filesRoot, file.storageKey),
      source,
      file.originalName,
      AbortSignal.any([signal, AbortSignal.timeout(READ_TIMEOUT_MS)]),
    );
  } catch (error) {
    signal.throwIfAborted();
    if (isMissingFile(error)) return "skip";
    const code = errorCode(error);
    await saveFileText(file, {
      status: code === "not-text" ? "skipped" : "failed",
      source,
      error: code,
      finished: true,
    });
    return "read";
  }
  await saveFileText(file, {
    status: "ready",
    source,
    ...result,
    finished: result.ocrPages.length === 0 || !scanSources.includes(source),
  });
  return "read";
};

const scanOne = async (
  file: FileToScan,
  storagePaths: WorkerStoragePaths,
  signal: AbortSignal,
  languages: string[],
): Promise<"read" | "skip"> => {
  // Pages read in other languages are read again from the first one.
  const done =
    file.ocrLanguages.join("+") === languages.join("+") ? file.ocrDone : 0;
  const page = file.ocrPages[done];
  if (page === undefined || (await isBlocked(file.id))) return "skip";
  const filePath = safeResolveStoragePath(
    storagePaths.filesRoot,
    file.storageKey,
  );
  const progress = {
    ocrPages: file.ocrPages,
    ocrDone: done + 1,
    ocrLanguages: languages,
  };
  let pageText: string;
  try {
    const timed = AbortSignal.any([
      signal,
      AbortSignal.timeout(SCAN_TIMEOUT_MS),
    ]);
    pageText =
      file.source === "pdf"
        ? await scanPdfPage(filePath, page, languages, timed)
        : await scanPicture(filePath, languages, timed);
  } catch (error) {
    signal.throwIfAborted();
    if (isMissingFile(error)) return "skip";
    await saveScannedPage(file, {
      ...progress,
      text: file.text,
      truncated: false,
      status: "failed",
      error: isTimeout(error) ? "scan-timeout" : "scan-failed",
      finished: true,
    });
    return "read";
  }
  // A failed save is the database's trouble, not the page's: the job retries.
  const kept = limitText(
    file.source === "pdf" ? placePage(file.text, page, pageText) : pageText,
  );
  // Full: the pages after this one are left out.
  const ocrPages = kept.truncated
    ? file.ocrPages.slice(0, done + 1)
    : file.ocrPages;
  await saveScannedPage(file, {
    ...progress,
    ...kept,
    ocrPages,
    finished: done + 1 >= ocrPages.length,
  });
  return "read";
};

/**
 * Reads the text of every live file that has none for its present bytes,
 * then scans pages without text. Files someone is waiting for go first.
 * Each scanned page is saved, so a restart goes on from the next one.
 */
export const handleFileTextRead = async (
  _job: unknown,
  storagePaths: WorkerStoragePaths,
  context: JobContext,
) => {
  continueNow = false;
  const pdfReader = getTextTools().pdftotext !== null;
  const skip: string[] = [];
  const stopAt = Date.now() + RUN_MS;
  let read = 0;
  let scanned = 0;
  const report = () => context.updateProgress({ read, scanned });

  const readAll = async (files: FileToRead[], sources: FileTextSource[]) => {
    for (const file of files) {
      context.signal.throwIfAborted();
      if (Date.now() >= stopAt) break;
      if (
        (await readOne(file, storagePaths, context.signal, sources)) === "skip"
      ) {
        skip.push(file.id);
      } else read += 1;
    }
    await report();
  };
  const scan = async (file: FileToScan, languages: string[]) => {
    if (
      (await scanOne(file, storagePaths, context.signal, languages)) === "skip"
    ) {
      skip.push(file.id);
    } else scanned += 1;
    await report();
  };

  while (Date.now() < stopAt) {
    context.signal.throwIfAborted();
    // Read each round, so turning scans off or changing languages acts at once.
    const { sources, languages } = await readScanPlan();
    const files = await listFilesToRead({ limit: BATCH, skip, pdfReader });
    if (files[0]?.wanted) {
      await readAll(
        files.filter((file) => file.wanted),
        sources,
      );
      continue;
    }
    const next = await findFileToScan({ sources, languages, skip });
    if (next?.wanted) await scan(next, languages);
    else if (files.length > 0) await readAll(files, sources);
    else if (next) await scan(next, languages);
    else return { read, scanned };
  }
  continueNow = true;
  return { read, scanned };
};
