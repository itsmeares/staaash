import { resolveUploadMimeType } from "@staaash/config/media-types";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { z } from "zod";

import {
  computeFileSha256,
  syncDirectory,
  syncFile,
} from "@staaash/db/storage-mutation-executor";

import { getSystemSettings } from "@/server/settings";
import { uploadSizeLimitError } from "@/server/uploads/admission";
import {
  maxFilesystemComponentBytes,
  normalizeFileName,
  takeUtf8Bytes,
} from "@/server/files/storage-layout";
import { getStorageRoot, getTmpUploadPath } from "@/server/storage";
import {
  commitStagedUploadWithLock,
  replaceCommittedUploadWithLock,
} from "@/server/storage-mutations";

export { computeFileSha256 };

export type UploadConflictStrategy = "fail" | "safeRename" | "replace";

export type UploadManifestItem = {
  clientKey: string;
  originalName: string;
  expectedChecksum?: string;
  conflictStrategy: UploadConflictStrategy;
  /** The modified time on the uploader's computer. */
  clientModifiedAt?: Date | null;
  /** With `replace`: apply only if the existing file is at this revision. */
  ifRevision?: number;
  /** With `replace`: apply only if the existing file has this id. */
  ifFileId?: string;
  /** This file's own retry key, so one file of a group can be retried alone. */
  idempotencyKey?: string;
};

export type UploadRequestItem = UploadManifestItem & {
  file: File;
};

export type StagedUploadFile = UploadManifestItem & {
  uploadId: string;
  tmpPath: string;
  mimeType: string;
  sizeBytes: number;
  actualChecksum: string;
};

type UploadErrorCode =
  | "CHECKSUM_MISMATCH"
  | "INVALID_UPLOAD_MANIFEST"
  | "UPLOAD_FILE_COUNT_MISMATCH"
  | "UPLOAD_TIMEOUT_EXCEEDED";

const uploadErrorStatuses: Record<UploadErrorCode, number> = {
  CHECKSUM_MISMATCH: 400,
  INVALID_UPLOAD_MANIFEST: 400,
  UPLOAD_FILE_COUNT_MISMATCH: 400,
  UPLOAD_TIMEOUT_EXCEEDED: 408,
};

const uploadErrorMessages: Record<UploadErrorCode, string> = {
  CHECKSUM_MISMATCH:
    "The uploaded file checksum did not match the expected SHA-256 value.",
  INVALID_UPLOAD_MANIFEST: "The upload manifest is invalid.",
  UPLOAD_FILE_COUNT_MISMATCH:
    "The upload manifest does not match the submitted file count.",
  UPLOAD_TIMEOUT_EXCEEDED: "The upload exceeded the configured time budget.",
};

class UploadError extends Error {
  readonly code: UploadErrorCode;
  readonly status: number;

  constructor(code: UploadErrorCode, message = uploadErrorMessages[code]) {
    super(message);
    this.name = "UploadError";
    this.code = code;
    this.status = uploadErrorStatuses[code];
  }
}

const uploadManifestSchema = z
  .array(
    z.object({
      clientKey: z.string().trim().min(1),
      originalName: z.string().trim().min(1),
      expectedChecksum: z
        .string()
        .trim()
        .regex(/^[a-f0-9]{64}$/i)
        .optional(),
      conflictStrategy: z
        .enum(["fail", "safeRename", "replace"])
        .default("fail"),
      clientModifiedAt: z.coerce.date().nullable().optional(),
      ifRevision: z.number().int().min(0).optional(),
      ifFileId: z.string().min(1).optional(),
      idempotencyKey: z.string().trim().min(1).max(200).optional(),
    }),
  )
  .nonempty();

export const createUploadDeadline = async (startTime = Date.now()) => {
  const settings = await getSystemSettings();
  return startTime + settings.uploadTimeoutMinutes * 60 * 1000;
};

export const parseUploadManifest = (
  manifest: string | null | undefined,
): UploadManifestItem[] => {
  if (!manifest) {
    throw new UploadError("INVALID_UPLOAD_MANIFEST");
  }

  try {
    return uploadManifestSchema.parse(JSON.parse(manifest));
  } catch {
    throw new UploadError("INVALID_UPLOAD_MANIFEST");
  }
};

export const pairUploadRequestItems = (
  manifest: UploadManifestItem[],
  files: File[],
): UploadRequestItem[] => {
  if (manifest.length !== files.length) {
    throw new UploadError("UPLOAD_FILE_COUNT_MISMATCH");
  }

  return manifest.map((entry, index) => ({
    ...entry,
    file: files[index] as File,
  }));
};

const ensureTmpRoot = async () => {
  await mkdir(path.join(getStorageRoot(), "tmp"), { recursive: true });
};

export const cleanupStagedUpload = async (tmpPath: string) => {
  await rm(tmpPath, {
    force: true,
  });
};

export const stageUpload = async (
  {
    clientKey,
    originalName,
    expectedChecksum,
    conflictStrategy,
    clientModifiedAt,
    file,
  }: UploadRequestItem,
  deadline?: Date | number | null,
): Promise<StagedUploadFile> => {
  normalizeFileName(originalName);
  const uploadId = randomUUID();
  const tmpPath = getTmpUploadPath(uploadId);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const settings = await getSystemSettings();
  const remainingBudgetMs =
    deadline == null
      ? settings.uploadTimeoutMinutes * 60 * 1000
      : Math.max(
          0,
          (deadline instanceof Date ? deadline.getTime() : deadline) -
            Date.now(),
        );

  await ensureTmpRoot();

  if (remainingBudgetMs <= 0) {
    throw new UploadError("UPLOAD_TIMEOUT_EXCEEDED");
  }

  const input = Readable.fromWeb(file.stream() as never);
  const output = createWriteStream(tmpPath, {
    flags: "wx",
  });
  const timeoutError = new UploadError("UPLOAD_TIMEOUT_EXCEEDED");
  const timeoutHandle = setTimeout(() => {
    input.destroy(timeoutError);
    output.destroy(timeoutError);
  }, remainingBudgetMs);

  input.on("data", (chunk) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

    sizeBytes += buffer.length;

    if (BigInt(sizeBytes) > settings.maxUploadBytes) {
      const error = uploadSizeLimitError(settings.maxUploadBytes);
      input.destroy(error);
      output.destroy(error);
      return;
    }

    hash.update(buffer);
  });

  try {
    await pipeline(input, output);
  } catch (error) {
    await cleanupStagedUpload(tmpPath);
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const actualChecksum = hash.digest("hex");

  if (expectedChecksum && actualChecksum !== expectedChecksum) {
    await cleanupStagedUpload(tmpPath);
    throw new UploadError("CHECKSUM_MISMATCH");
  }

  // The journal treats a missing staged file as ambiguous, so it must be on
  // disk, entry included, before a mutation can name it.
  try {
    await syncFile(tmpPath);
    await syncDirectory(path.dirname(tmpPath));
  } catch (error) {
    await cleanupStagedUpload(tmpPath);
    throw error;
  }

  return {
    uploadId,
    clientKey,
    originalName,
    expectedChecksum,
    conflictStrategy,
    clientModifiedAt,
    tmpPath,
    mimeType: resolveUploadMimeType(file.type, originalName),
    sizeBytes,
    actualChecksum,
  };
};

export const commitStagedUpload = async (
  stagedFile: Pick<StagedUploadFile, "tmpPath">,
  targetPath: string,
  options?: {
    lockKeys?: string[];
    deadline?: Date | number | null;
  },
) => {
  await commitStagedUploadWithLock({
    stagedPath: stagedFile.tmpPath,
    targetPath,
    lockKeys: options?.lockKeys ?? [],
    deadline: options?.deadline,
  });
};

export const replaceCommittedUpload = async <T>({
  stagedFile,
  targetPath,
  applyMetadataUpdate,
  lockKeys = [],
  deadline,
}: {
  stagedFile: Pick<StagedUploadFile, "tmpPath" | "uploadId">;
  targetPath: string;
  applyMetadataUpdate: () => Promise<T>;
  lockKeys?: string[];
  deadline?: Date | number | null;
}) => {
  return replaceCommittedUploadWithLock({
    stagedPath: stagedFile.tmpPath,
    targetPath,
    uploadId: stagedFile.uploadId,
    lockKeys,
    deadline,
    applyMetadataUpdate,
  });
};

const splitFileName = (name: string) => {
  const extension = path.extname(name);
  const baseName = extension ? name.slice(0, -extension.length) : name;
  return {
    baseName,
    extension,
  };
};

export const buildSafeRenamedFileName = (
  originalName: string,
  existingNames: Iterable<string>,
) => {
  // Skip case variants too, so the new name also fits on disks that ignore case.
  const takenNames = new Set(
    Array.from(existingNames, (name) => name.toLowerCase()),
  );
  const isTaken = (name: string) => takenNames.has(name.toLowerCase());

  if (!isTaken(originalName)) {
    return originalName;
  }

  const { baseName, extension } = splitFileName(originalName);

  for (let attempt = 1; attempt < 10_000; attempt += 1) {
    // Trim the base, not the suffix, so the renamed name still fits on disk.
    const suffix = ` (${attempt})${extension}`;
    const candidate = `${takeUtf8Bytes(
      baseName,
      maxFilesystemComponentBytes - Buffer.byteLength(suffix),
    )}${suffix}`;

    if (!isTaken(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a safe renamed filename.");
};
