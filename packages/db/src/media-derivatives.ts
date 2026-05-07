import { getPrisma } from "./client";
import {
  MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
  MEDIA_DERIVATIVE_CLEANUP_JOB_KIND,
  ensureBackgroundJobScheduled,
} from "./jobs";

export const DERIVATIVE_KIND_PREVIEW = "preview" as const;
export const DERIVATIVE_PROFILE_1080P = "preview-1080p" as const;

export const DERIVATIVE_STATUS_QUEUED = "queued" as const;
export const DERIVATIVE_STATUS_PROCESSING = "processing" as const;
export const DERIVATIVE_STATUS_READY = "ready" as const;
export const DERIVATIVE_STATUS_FAILED = "failed" as const;
export const DERIVATIVE_STATUS_STALE = "stale" as const;

export type DerivativeKind = typeof DERIVATIVE_KIND_PREVIEW;
export type DerivativeProfile = typeof DERIVATIVE_PROFILE_1080P;
export type DerivativeStatus =
  | typeof DERIVATIVE_STATUS_QUEUED
  | typeof DERIVATIVE_STATUS_PROCESSING
  | typeof DERIVATIVE_STATUS_READY
  | typeof DERIVATIVE_STATUS_FAILED
  | typeof DERIVATIVE_STATUS_STALE;

export type DerivativeGenerateReason =
  | "share-created"
  | "upload"
  | "first-view"
  | "manual-regenerate";

export type MediaDerivativeRecord = {
  id: string;
  fileId: string;
  kind: string;
  profile: string;
  status: string;
  storageKey: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  error: string | null;
  pinnedByAdmin: boolean;
  lastViewedAt: Date | null;
  lastSharedAt: Date | null;
  generatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type DerivativeClient = {
  mediaDerivative: {
    findFirst(args: object): Promise<MediaDerivativeRecord | null>;
    findMany(args: object): Promise<MediaDerivativeRecord[]>;
    upsert(args: object): Promise<MediaDerivativeRecord>;
    update(args: object): Promise<MediaDerivativeRecord>;
    updateMany(args: object): Promise<{ count: number }>;
    delete(args: object): Promise<MediaDerivativeRecord>;
  };
  shareLink: {
    findFirst(args: object): Promise<{ id: string } | null>;
  };
};

const MAX_STORED_ERROR_LENGTH = 2000;

export const truncateDerivativeError = (err: string): string =>
  err.length > MAX_STORED_ERROR_LENGTH
    ? err.slice(0, MAX_STORED_ERROR_LENGTH) + "…"
    : err;

export const buildDerivativeStorageKey = (
  ownerUserId: string,
  fileId: string,
  profile: DerivativeProfile,
): string => `derivatives/${ownerUserId}/${fileId}/${profile}.mp4`;

export const buildDerivativeDedupeKey = (
  fileId: string,
  kind: DerivativeKind,
  profile: DerivativeProfile,
) => `${MEDIA_DERIVATIVE_GENERATE_JOB_KIND}:${fileId}:${kind}:${profile}`;

export const scheduleDerivativeGenerate = async ({
  fileId,
  kind = DERIVATIVE_KIND_PREVIEW,
  profile = DERIVATIVE_PROFILE_1080P,
  reason,
  now = new Date(),
}: {
  fileId: string;
  kind?: DerivativeKind;
  profile?: DerivativeProfile;
  reason: DerivativeGenerateReason;
  now?: Date;
}) => {
  return ensureBackgroundJobScheduled({
    kind: MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
    runAt: now,
    payloadJson: { fileId, kind, profile, reason },
    dedupeKey: buildDerivativeDedupeKey(fileId, kind, profile),
    now,
  });
};

export const scheduleDerivativeCleanup = async ({
  now = new Date(),
}: { now?: Date } = {}) => {
  return ensureBackgroundJobScheduled({
    kind: MEDIA_DERIVATIVE_CLEANUP_JOB_KIND,
    runAt: now,
    payloadJson: {},
    now,
  });
};

export const findReadyDerivative = async (
  fileId: string,
  kind: DerivativeKind = DERIVATIVE_KIND_PREVIEW,
  profile: DerivativeProfile = DERIVATIVE_PROFILE_1080P,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord | null> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.findFirst({
    where: { fileId, kind, profile, status: DERIVATIVE_STATUS_READY },
  });
};

export const findDerivative = async (
  fileId: string,
  kind: DerivativeKind = DERIVATIVE_KIND_PREVIEW,
  profile: DerivativeProfile = DERIVATIVE_PROFILE_1080P,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord | null> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.findFirst({ where: { fileId, kind, profile } });
};

export const upsertDerivativeQueued = async (
  fileId: string,
  kind: DerivativeKind,
  profile: DerivativeProfile,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.upsert({
    where: { fileId_kind_profile: { fileId, kind, profile } },
    create: { fileId, kind, profile, status: DERIVATIVE_STATUS_QUEUED },
    update: {
      status: DERIVATIVE_STATUS_QUEUED,
      error: null,
      storageKey: null,
      generatedAt: null,
    },
  });
};

export const markDerivativeProcessing = async (
  id: string,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.update({
    where: { id },
    data: { status: DERIVATIVE_STATUS_PROCESSING, error: null },
  });
};

export const markDerivativeReady = async (
  id: string,
  data: {
    storageKey: string;
    mimeType: string;
    sizeBytes: bigint;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    videoCodec: string | null;
    audioCodec: string | null;
    generatedAt: Date;
  },
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.update({
    where: { id },
    data: { ...data, status: DERIVATIVE_STATUS_READY, error: null },
  });
};

export const markDerivativeFailed = async (
  id: string,
  errorMessage: string,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.update({
    where: { id },
    data: {
      status: DERIVATIVE_STATUS_FAILED,
      error: truncateDerivativeError(errorMessage),
    },
  });
};

export const touchDerivativeViewed = async (
  id: string,
  now: Date,
  client?: DerivativeClient,
): Promise<void> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  await db.mediaDerivative.update({
    where: { id },
    data: { lastViewedAt: now },
  });
};

export const touchDerivativeShared = async (
  fileId: string,
  kind: DerivativeKind,
  profile: DerivativeProfile,
  now: Date,
  client?: DerivativeClient,
): Promise<void> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  await db.mediaDerivative.updateMany({
    where: { fileId, kind, profile },
    data: { lastSharedAt: now },
  });
};

export const markDerivativeStale = async (
  id: string,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.update({
    where: { id },
    data: {
      status: DERIVATIVE_STATUS_STALE,
      storageKey: null,
      sizeBytes: null,
    },
  });
};

export const listReadyDerivativesForCleanup = async (
  retentionCutoff: Date,
  client?: DerivativeClient,
): Promise<MediaDerivativeRecord[]> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  return db.mediaDerivative.findMany({
    where: {
      status: DERIVATIVE_STATUS_READY,
      pinnedByAdmin: false,
      storageKey: { not: null },
      updatedAt: { lt: retentionCutoff },
    },
  });
};

export const isFileActivelyShared = async (
  fileId: string,
  client?: DerivativeClient,
): Promise<boolean> => {
  const db = client ?? (getPrisma() as unknown as DerivativeClient);
  const now = new Date();

  const directShare = await db.shareLink.findFirst({
    where: {
      fileId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });

  return directShare !== null;
};
