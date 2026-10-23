import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { z } from "zod";

import { computeFileSha256 } from "@staaash/db/storage-mutation-executor";

import { getSystemSettings } from "@/server/settings";
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

const EXTENSION_MIME_FALLBACKS: Record<string, string> = {
  heic: "image/heic",
  heif: "image/heif",
};

const resolveMimeType = (file: File): string => {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return (ext && EXTENSION_MIME_FALLBACKS[ext]) ?? "application/octet-stream";
};

export type UploadConflictStrategy = "fail" | "safeRename" | "replace";

export type UploadManifestItem = {
  clientKey: string;
  originalName: string;
  expectedChecksum?: string;
  conflictStrategy: UploadConflictStrategy;
  /** The modified time on the uploader's computer. */
  clientModifiedAt?: Date;
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
  | "UPLOAD_SIZE_LIMIT_EXCEEDED"
  | "UPLOAD_TIMEOUT_EXCEEDED";

const uploadErrorStatuses: Record<UploadErrorCode, number> = {
  CHECKSUM_MISMATCH: 400,
  INVALID_UPLOAD_MANIFEST: 400,
  UPLOAD_FILE_COUNT_MISMATCH: 400,
  UPLOAD_SIZE_LIMIT_EXCEEDED: 413,
  UPLOAD_TIMEOUT_EXCEEDED: 408,
};

const uploadErrorMessages: Record<UploadErrorCode, string> = {
  CHECKSUM_MISMATCH:
    "The uploaded file checksum did not match the expected SHA-256 value.",
  INVALID_UPLOAD_MANIFEST: "The upload manifest is invalid.",
  UPLOAD_FILE_COUNT_MISMATCH:
    "The upload manifest does not match the submitted file count.",
  UPLOAD_SIZE_LIMIT_EXCEEDED:
    "The uploaded file exceeds the configured maximum size.",
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

let _uploadPolicy: {
  maxUploadBytes: number;
  timeoutMinutes: number;
} | null = null;

const getUploadPolicy = async () => {
  if (_uploadPolicy) return _uploadPolicy;
  const s = await getSystemSettings();
  _uploadPolicy = {
    maxUploadBytes: Number(s.maxUploadBytes),
    timeoutMinutes: s.uploadTimeoutMinutes,
  };
  return _uploadPolicy;
};

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
      clientModifiedAt: z.coerce.date().optional(),
    }),
  )
  .nonempty();

const getUploadTimeoutBudgetMs = async () => {
  const policy = await getUploadPolicy();
  return policy.timeoutMinutes * 60 * 1000;
};

export const createUploadDeadline = async (startTime = Date.now()) =>
  startTime + (await getUploadTimeoutBudgetMs());

const getRemainingUploadBudgetMs = async (
  deadline: Date | number | null | undefined,
) => {
  if (deadline === null || deadline === undefined) {
    return getUploadTimeoutBudgetMs();
  }

  const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline;
  return Math.max(0, deadlineMs - Date.now());
};

const isUploadSizeAllowed = async (sizeBytes: number) => {
  const policy = await getUploadPolicy();
  return sizeBytes <= policy.maxUploadBytes;
};

export const assertUploadSizeAllowed = async (sizeBytes: number) => {
  if (!(await isUploadSizeAllowed(sizeBytes))) {
    throw new UploadError("UPLOAD_SIZE_LIMIT_EXCEEDED");
  }
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
  const policy = await getUploadPolicy();
  const remainingBudgetMs = await getRemainingUploadBudgetMs(deadline);

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

    if (sizeBytes > policy.maxUploadBytes) {
      input.destroy(new UploadError("UPLOAD_SIZE_LIMIT_EXCEEDED"));
      output.destroy(new UploadError("UPLOAD_SIZE_LIMIT_EXCEEDED"));
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

  return {
    uploadId,
    clientKey,
    originalName,
    expectedChecksum,
    conflictStrategy,
    clientModifiedAt,
    tmpPath,
    mimeType: resolveMimeType(file),
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
  const takenNames = new Set(Array.from(existingNames));

  if (!takenNames.has(originalName)) {
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

    if (!takenNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a safe renamed filename.");
};
