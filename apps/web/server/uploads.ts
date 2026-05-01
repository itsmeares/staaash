import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, opendir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { z } from "zod";

import { getSystemSettings } from "@/server/settings";
import { getStorageRoot, getTmpUploadPath } from "@/server/storage";
import {
  commitStagedUploadWithLock,
  replaceCommittedUploadWithLock,
} from "@/server/storage-mutations";

export type UploadSurface = "interactiveWeb" | "bulk" | "api";

export type UploadConflictStrategy = "fail" | "safeRename" | "replace";

export type UploadCommitStatus = "staged" | "verified" | "committed" | "failed";

export type UploadSession = {
  id: string;
  tmpPath: string;
  status: UploadCommitStatus;
  expectedChecksum?: string;
  conflictStrategy: UploadConflictStrategy;
};

export type UploadVerificationResult = {
  status: UploadCommitStatus;
  checksumMatches: boolean;
  actualChecksum: string;
  expectedChecksum?: string;
};

export type UploadManifestItem = {
  clientKey: string;
  originalName: string;
  expectedChecksum?: string;
  conflictStrategy: UploadConflictStrategy;
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

export type StagingCleanupResult = {
  scannedCount: number;
  deletedCount: number;
  deletedPaths: string[];
};

export type UploadErrorCode =
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

export class UploadError extends Error {
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
  stagingRetentionHours: number;
} | null = null;

export const getUploadPolicy = async () => {
  if (_uploadPolicy) return _uploadPolicy;
  const s = await getSystemSettings();
  _uploadPolicy = {
    maxUploadBytes: Number(s.maxUploadBytes),
    timeoutMinutes: s.uploadTimeoutMinutes,
    stagingRetentionHours: s.uploadStagingRetentionHours,
  };
  return _uploadPolicy;
};

const uploadManifestSchema = z.array(
  z.object({
    clientKey: z.string().trim().min(1),
    originalName: z.string().trim().min(1),
    expectedChecksum: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    conflictStrategy: z.enum(["fail", "safeRename", "replace"]).default("fail"),
  }),
);

export const getDefaultUploadConflictStrategy = (
  surface: UploadSurface,
): UploadConflictStrategy =>
  surface === "interactiveWeb" ? "fail" : "safeRename";

export const getUploadTimeoutBudgetMs = async () => {
  const policy = await getUploadPolicy();
  return policy.timeoutMinutes * 60 * 1000;
};

export const createUploadDeadline = async (startTime = Date.now()) =>
  startTime + (await getUploadTimeoutBudgetMs());

export const getRemainingUploadBudgetMs = async (
  deadline: Date | number | null | undefined,
) => {
  if (deadline === null || deadline === undefined) {
    return getUploadTimeoutBudgetMs();
  }

  const deadlineMs = deadline instanceof Date ? deadline.getTime() : deadline;
  return Math.max(0, deadlineMs - Date.now());
};

export const getUploadStagingTtlMs = async () => {
  const policy = await getUploadPolicy();
  return policy.stagingRetentionHours * 60 * 60 * 1000;
};

export const isUploadSizeAllowed = async (sizeBytes: number) => {
  const policy = await getUploadPolicy();
  return sizeBytes <= policy.maxUploadBytes;
};

export const assertUploadSizeAllowed = async (sizeBytes: number) => {
  if (!(await isUploadSizeAllowed(sizeBytes))) {
    throw new UploadError("UPLOAD_SIZE_LIMIT_EXCEEDED");
  }
};

export const createUploadSession = (
  surface: UploadSurface,
  expectedChecksum?: string,
  status: UploadCommitStatus = "staged",
  conflictStrategy = getDefaultUploadConflictStrategy(surface),
): UploadSession => {
  const id = randomUUID();

  return {
    id,
    tmpPath: getTmpUploadPath(id),
    status,
    expectedChecksum,
    conflictStrategy,
  };
};

export const computeFileSha256 = async (filePath: string) =>
  new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);

    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });

export const verifyUploadChecksum = async (
  filePath: string,
  expectedChecksum?: string,
): Promise<UploadVerificationResult> => {
  const actualChecksum = await computeFileSha256(filePath);
  const checksumMatches =
    !expectedChecksum || actualChecksum === expectedChecksum;

  return {
    status: checksumMatches ? "verified" : "failed",
    checksumMatches,
    actualChecksum,
    expectedChecksum,
  };
};

export const shouldCleanupStagedUpload = async (
  createdAt: Date,
  now = new Date(),
) => now.getTime() - createdAt.getTime() >= (await getUploadStagingTtlMs());

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
    file,
  }: UploadRequestItem,
  deadline?: Date | number | null,
): Promise<StagedUploadFile> => {
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
    tmpPath,
    mimeType: file.type || "application/octet-stream",
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
    const candidate = `${baseName} (${attempt})${extension}`;

    if (!takenNames.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a safe renamed filename.");
};

export const copyCommittedUpload = async (
  sourcePath: string,
  destinationPath: string,
) => {
  await mkdir(path.dirname(destinationPath), {
    recursive: true,
  });
  await copyFile(sourcePath, destinationPath);
};

export const cleanupExpiredStagingFiles = async (
  now = new Date(),
): Promise<StagingCleanupResult> => {
  const tmpRoot = path.join(getStorageRoot(), "tmp");
  const deletedPaths: string[] = [];
  let scannedCount = 0;

  try {
    const directory = await opendir(tmpRoot);

    for await (const entry of directory) {
      if (!entry.isFile() || !entry.name.endsWith(".upload")) {
        continue;
      }

      const absolutePath = path.join(tmpRoot, entry.name);
      const stats = await stat(absolutePath);
      scannedCount += 1;

      if (!(await shouldCleanupStagedUpload(stats.mtime, now))) {
        continue;
      }

      await rm(absolutePath, { force: true });
      deletedPaths.push(absolutePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        scannedCount: 0,
        deletedCount: 0,
        deletedPaths: [],
      };
    }

    throw error;
  }

  return {
    scannedCount,
    deletedCount: deletedPaths.length,
    deletedPaths,
  };
};
