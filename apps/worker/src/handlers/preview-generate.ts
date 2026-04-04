import path from "node:path";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { z } from "zod";
import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  DEFAULT_PREVIEW_MAX_SOURCE_BYTES,
  DEFAULT_PREVIEW_TEXT_MAX_BYTES,
  PREVIEW_THUMBNAIL_WIDTH,
  getPreviewAssetDirectoryKey,
  getPreviewAssetStorageKey,
  resolvePreviewKind,
} from "@staaash/db/preview-contract";

const payloadSchema = z.object({
  fileId: z.string().min(1),
});

const previewEnvSchema = z.object({
  FILES_ROOT: z.string().trim().min(1),
  PREVIEW_MAX_SOURCE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PREVIEW_MAX_SOURCE_BYTES),
  PREVIEW_TEXT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PREVIEW_TEXT_MAX_BYTES),
});

const resolveStoragePath = (filesRoot: string, key: string) =>
  path.resolve(filesRoot, key);

const generateImagePreview = async (
  sourcePath: string,
  outputPath: string,
  thumbnailWidth: number,
): Promise<void> => {
  const { default: sharp } = await import("sharp");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(sourcePath)
    .resize(thumbnailWidth, null, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outputPath);
};

const generatePdfPreview = async (
  sourcePath: string,
  outputPath: string,
  thumbnailWidth: number,
): Promise<void> => {
  // Dynamic import — pdftoimg-js requires canvas peer dep
  const { pdfToImg } = (await import("pdftoimg-js" as string)) as {
    pdfToImg: (src: string, opts: Record<string, unknown>) => Promise<Buffer[]>;
  };
  const pages = await pdfToImg(sourcePath, {
    pages: "firstPage",
    imgType: "png",
  });

  if (!pages || pages.length === 0) {
    throw new Error("PDF rendered no pages.");
  }

  const { default: sharp } = await import("sharp");
  await mkdir(path.dirname(outputPath), { recursive: true });
  await sharp(pages[0])
    .resize(thumbnailWidth, null, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(outputPath);
};

const generateTextPreview = async (
  sourcePath: string,
  outputPath: string,
  maxBytes: number,
): Promise<void> => {
  const fd = await import("node:fs/promises").then((m) =>
    m.open(sourcePath, "r"),
  );
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fd.read(buf, 0, maxBytes, 0);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buf.subarray(0, bytesRead), "utf8");
  } finally {
    await fd.close();
  }
};

const generateAudioPreview = async (
  sourcePath: string,
  outputPath: string,
): Promise<void> => {
  const { parseFile } = await import("music-metadata");
  const metadata = await parseFile(sourcePath);
  const summary = {
    title: metadata.common.title ?? null,
    artist: metadata.common.artist ?? null,
    album: metadata.common.album ?? null,
    year: metadata.common.year ?? null,
    duration: metadata.format.duration ?? null,
    bitrate: metadata.format.bitrate ?? null,
    sampleRate: metadata.format.sampleRate ?? null,
    codec: metadata.format.codec ?? null,
  };
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(summary, null, 2), "utf8");
};

const generateVideoPreview = async (
  sourcePath: string,
  outputPath: string,
): Promise<void> => {
  await mkdir(path.dirname(outputPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ffmpeg = require("fluent-ffmpeg") as (
      src: string,
    ) => import("fluent-ffmpeg").FfmpegCommand;

    ffmpeg(sourcePath)
      .on("error", reject)
      .on("end", () => resolve())
      .screenshots({
        timestamps: ["00:00:01"],
        filename: path.basename(outputPath),
        folder: path.dirname(outputPath),
        size: `${PREVIEW_THUMBNAIL_WIDTH}x?`,
      });
  });
};

const setFilePreviewStatus = async (
  fileId: string,
  status: "pending" | "ready" | "failed",
): Promise<void> => {
  const prisma = getPrisma();
  await (
    prisma as unknown as {
      file: {
        update(args: {
          where: { id: string };
          data: { previewStatus: string };
        }): Promise<unknown>;
      };
    }
  ).file.update({
    where: { id: fileId },
    data: { previewStatus: status },
  });
};

/**
 * Handles a `preview.generate` job.
 *
 * Error handling contract:
 * - Unsupported MIME / oversize input: set previewStatus=failed, return cleanly
 *   (job is marked succeeded by the dispatcher — no job backlog poisoning).
 * - Retryable processing error: re-throw so the job framework handles retry.
 * - Dead-letter (final failure): the dispatcher sets previewStatus=failed before
 *   marking the job dead.
 *
 * @param job The background job record carrying { fileId } as payload.
 * @param filesRoot Absolute path to the FILES_ROOT directory.
 * @param isDeadLetter Set to true only when called after the job has gone dead
 *   to flip previewStatus to failed without re-throwing.
 */
export const handlePreviewGenerate = async (
  job: BackgroundJobRecord,
  filesRoot: string,
  isDeadLetter = false,
): Promise<void> => {
  const { PREVIEW_MAX_SOURCE_BYTES, PREVIEW_TEXT_MAX_BYTES } =
    previewEnvSchema.parse(process.env);

  const payload = payloadSchema.parse(job.payloadJson);
  const { fileId } = payload;

  if (isDeadLetter) {
    await setFilePreviewStatus(fileId, "failed");
    return;
  }

  // Load the file record from DB
  const prisma = getPrisma();
  const fileRecord = await (
    prisma as unknown as {
      file: {
        findUnique(args: {
          where: { id: string };
          select: {
            id: true;
            storageKey: true;
            mimeType: true;
            ownerUserId: true;
          };
        }): Promise<{
          id: string;
          storageKey: string;
          mimeType: string;
          ownerUserId: string;
        } | null>;
      };
    }
  ).file.findUnique({
    where: { id: fileId },
    select: { id: true, storageKey: true, mimeType: true, ownerUserId: true },
  });

  if (!fileRecord) {
    // File was deleted before the job ran — treat as terminal, no status flip needed
    return;
  }

  const previewKind = resolvePreviewKind(fileRecord.mimeType);

  if (!previewKind) {
    // Unsupported MIME type — terminal, not retryable
    await setFilePreviewStatus(fileId, "failed");
    return;
  }

  const sourcePath = resolveStoragePath(filesRoot, fileRecord.storageKey);

  // Check source file size
  let fileStats: { size: number };
  try {
    fileStats = await stat(sourcePath);
  } catch {
    // File missing from disk — treat as terminal
    await setFilePreviewStatus(fileId, "failed");
    return;
  }

  if (fileStats.size > PREVIEW_MAX_SOURCE_BYTES) {
    await setFilePreviewStatus(fileId, "failed");
    return;
  }

  const outputKey = getPreviewAssetStorageKey(
    fileRecord.ownerUserId,
    fileId,
    previewKind,
  );
  const outputPath = resolveStoragePath(filesRoot, outputKey);

  // Generate the preview — retryable errors propagate upward
  switch (previewKind) {
    case "image":
      await generateImagePreview(
        sourcePath,
        outputPath,
        PREVIEW_THUMBNAIL_WIDTH,
      );
      break;
    case "pdf":
      await generatePdfPreview(sourcePath, outputPath, PREVIEW_THUMBNAIL_WIDTH);
      break;
    case "text":
      await generateTextPreview(sourcePath, outputPath, PREVIEW_TEXT_MAX_BYTES);
      break;
    case "audio":
      await generateAudioPreview(sourcePath, outputPath);
      break;
    case "video":
      await generateVideoPreview(sourcePath, outputPath);
      break;
  }

  await setFilePreviewStatus(fileId, "ready");
};

/**
 * Removes all preview assets for the given files.
 * Called on hard delete (clearTrash, trash retention) to keep previews/ tidy.
 */
export const removePreviewAssets = async (
  ownerUserId: string,
  fileIds: string[],
  filesRoot: string,
): Promise<void> => {
  await Promise.all(
    fileIds.map((fileId) => {
      const dirKey = getPreviewAssetDirectoryKey(ownerUserId, fileId);
      const dirPath = resolveStoragePath(filesRoot, dirKey);
      return rm(dirPath, { recursive: true, force: true });
    }),
  );
};
