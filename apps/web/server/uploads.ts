import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

import { env } from "@/lib/env";
import { getTmpUploadPath } from "@/server/storage";
import type {
  ConflictResolution,
  UploadCommitStatus,
  UploadSession,
  UploadVerificationResult,
} from "@/server/types";

export type UploadSurface = "interactiveWeb" | "bulk" | "api";

export const uploadPolicy = {
  maxUploadBytes: env.MAX_UPLOAD_BYTES,
  timeoutMinutes: env.UPLOAD_TIMEOUT_MINUTES,
  stagingRetentionHours: env.UPLOAD_STAGING_RETENTION_HOURS,
} as const;

export const conflictResolutionPolicy = {
  interactiveWeb: "prompt" as const,
  nonInteractive: "safeRename" as const,
} as const;

export const getDefaultConflictResolution = (
  surface: UploadSurface,
): ConflictResolution =>
  surface === "interactiveWeb"
    ? conflictResolutionPolicy.interactiveWeb
    : conflictResolutionPolicy.nonInteractive;

export const getUploadTimeoutBudgetMs = () =>
  uploadPolicy.timeoutMinutes * 60 * 1000;

export const getUploadStagingTtlMs = () =>
  uploadPolicy.stagingRetentionHours * 60 * 60 * 1000;

export const isUploadSizeAllowed = (sizeBytes: number) =>
  sizeBytes <= uploadPolicy.maxUploadBytes;

export const assertUploadSizeAllowed = (sizeBytes: number) => {
  if (!isUploadSizeAllowed(sizeBytes)) {
    throw new RangeError(
      `Upload exceeds the ${uploadPolicy.maxUploadBytes} byte limit.`,
    );
  }
};

export const createUploadSession = (
  surface: UploadSurface,
  expectedChecksum?: string,
  status: UploadCommitStatus = "staged",
): UploadSession => {
  const id = randomUUID();

  return {
    id,
    tmpPath: getTmpUploadPath(id),
    conflictResolution: getDefaultConflictResolution(surface),
    status,
    expectedChecksum,
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

export const shouldCleanupStagedUpload = (createdAt: Date, now = new Date()) =>
  now.getTime() - createdAt.getTime() >= getUploadStagingTtlMs();
