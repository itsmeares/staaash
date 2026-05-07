import path from "node:path";
import { mkdir, rename, rm, stat } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_PROFILE_1080P,
  DERIVATIVE_STATUS_PROCESSING,
  buildDerivativeStorageKey,
  markDerivativeFailed,
  markDerivativeReady,
  upsertDerivativeQueued,
} from "@staaash/db/media-derivatives";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import {
  getFfmpegHealth,
  isStreamCopyCompatible,
  runFfmpegStreamCopy,
  runFfmpegTranscode,
  runFfprobe,
} from "../ffmpeg.js";

type FileRecord = {
  id: string;
  ownerUserId: string;
  mimeType: string;
  sizeBytes: bigint;
  storageKey: string;
  deletedAt: Date | null;
};

type SystemSettingsRecord = {
  mediaPreviewEnabled: boolean;
  mediaPreviewThresholdBytes: bigint;
  mediaPreviewMaxHeight: number;
  mediaPreviewCrf: number;
};

type PrismaClient = {
  file: {
    findUnique(args: object): Promise<FileRecord | null>;
  };
  systemSettings: {
    findUnique(args: object): Promise<SystemSettingsRecord | null>;
  };
  mediaDerivative: {
    upsert(args: object): Promise<{ id: string; status: string }>;
    update(args: object): Promise<{ id: string; status: string }>;
  };
};

type MediaDerivativeGeneratePayload = {
  fileId: string;
  kind: string;
  profile: string;
  reason: string;
};

const parsePayload = (payloadJson: unknown): MediaDerivativeGeneratePayload => {
  const p = payloadJson as Record<string, unknown>;
  if (
    typeof p.fileId !== "string" ||
    typeof p.kind !== "string" ||
    typeof p.profile !== "string" ||
    typeof p.reason !== "string"
  ) {
    throw new Error("Invalid media.derivative.generate payload.");
  }
  return {
    fileId: p.fileId,
    kind: p.kind,
    profile: p.profile,
    reason: p.reason,
  };
};

const DEFAULT_SETTINGS: SystemSettingsRecord = {
  mediaPreviewEnabled: true,
  mediaPreviewThresholdBytes: 367001600n,
  mediaPreviewMaxHeight: 1080,
  mediaPreviewCrf: 22,
};

export const handleMediaDerivativeGenerate = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  const health = getFfmpegHealth();
  if (!health.available) {
    throw new Error(
      `Media preview generation unavailable: FFmpeg not found. ${health.lastProbeError ?? ""}`.trim(),
    );
  }

  const payload = parsePayload(job.payloadJson);
  const prisma = getPrisma() as unknown as PrismaClient;

  const rawSettings = await prisma.systemSettings.findUnique({
    where: { id: "singleton" },
    select: {
      mediaPreviewEnabled: true,
      mediaPreviewThresholdBytes: true,
      mediaPreviewMaxHeight: true,
      mediaPreviewCrf: true,
    } as object,
  });
  const settings: SystemSettingsRecord = rawSettings ?? DEFAULT_SETTINGS;

  if (!settings.mediaPreviewEnabled) {
    return;
  }

  const file = await prisma.file.findUnique({
    where: { id: payload.fileId },
    select: {
      id: true,
      ownerUserId: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      deletedAt: true,
    } as object,
  });

  if (!file || file.deletedAt !== null) {
    throw new Error(`File ${payload.fileId} not found or deleted.`);
  }

  if (!file.mimeType.startsWith("video/")) {
    return;
  }

  if (
    payload.reason !== "manual-regenerate" &&
    file.sizeBytes < settings.mediaPreviewThresholdBytes
  ) {
    return;
  }

  const kind =
    payload.kind === DERIVATIVE_KIND_PREVIEW
      ? DERIVATIVE_KIND_PREVIEW
      : DERIVATIVE_KIND_PREVIEW;
  const profile =
    payload.profile === DERIVATIVE_PROFILE_1080P
      ? DERIVATIVE_PROFILE_1080P
      : DERIVATIVE_PROFILE_1080P;

  const derivative = await upsertDerivativeQueued(file.id, kind, profile);

  await (getPrisma() as unknown as PrismaClient).mediaDerivative.update({
    where: { id: derivative.id },
    data: { status: DERIVATIVE_STATUS_PROCESSING, error: null } as object,
  });

  const inputPath = path.resolve(storagePaths.filesRoot, file.storageKey);
  const storageKey = buildDerivativeStorageKey(
    file.ownerUserId,
    file.id,
    profile,
  );
  const outputPath = path.resolve(storagePaths.filesRoot, storageKey);
  const tmpDir = path.resolve(storagePaths.tmpRoot, "derivatives");
  const tmpPath = path.resolve(tmpDir, `${derivative.id}.mp4.tmp`);

  await mkdir(tmpDir, { recursive: true });

  let probe;
  try {
    probe = await runFfprobe(inputPath);
  } catch (err) {
    await markDerivativeFailed(derivative.id, String(err));
    throw err;
  }

  try {
    if (isStreamCopyCompatible(probe)) {
      await runFfmpegStreamCopy(inputPath, tmpPath);
    } else {
      await runFfmpegTranscode(
        inputPath,
        tmpPath,
        settings.mediaPreviewMaxHeight,
        settings.mediaPreviewCrf,
      );
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await rename(tmpPath, outputPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    await markDerivativeFailed(derivative.id, String(err));
    throw err;
  }

  const outputStats = await stat(outputPath);
  const videoStream = probe.streams.find((s) => s.codec_type === "video");
  const audioStream = probe.streams.find((s) => s.codec_type === "audio");
  const durationSeconds = probe.format.duration
    ? parseFloat(probe.format.duration)
    : null;

  await markDerivativeReady(derivative.id, {
    storageKey,
    mimeType: "video/mp4",
    sizeBytes: BigInt(outputStats.size),
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    videoCodec: videoStream?.codec_name ?? null,
    audioCodec: audioStream?.codec_name ?? null,
    generatedAt: new Date(),
  });
};
