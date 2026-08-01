import path from "node:path";
import { access, mkdir, rm, stat } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  DERIVATIVE_KIND_POSTER,
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_PROFILE_1080P,
  DERIVATIVE_PROFILE_SOCIAL_JPEG,
  DERIVATIVE_STATUS_PROCESSING,
  DERIVATIVE_STATUS_STALE,
  buildDerivativeStorageKey,
  markDerivativeFailed,
  markDerivativeReady,
  upsertDerivativeQueued,
} from "@staaash/db/media-derivatives";
import { calculateStorageFileChecksum } from "@staaash/db/storage-mutation-executor";
import { findBlockingStorageMutationForEntity } from "@staaash/db/storage-mutations";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import type { JobContext } from "../job-context.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";
import {
  getFfmpegHealth,
  isStreamCopyCompatible,
  runFfmpegPoster,
  runFfmpegStreamCopy,
  runFfmpegTranscode,
  runFfprobe,
} from "../ffmpeg.js";
import {
  assertWorkerMutationMayStart,
  buildArtifactPublishSteps,
  runWorkerStorageMutation,
  StorageMutationOwnedError,
} from "../durable-storage-mutation.js";

type FileRecord = {
  id: string;
  ownerUserId: string;
  mimeType: string;
  sizeBytes: bigint;
  storageKey: string;
  deletedAt: Date | null;
  storageRevision: number;
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
    findUnique(args: object): Promise<{
      id: string;
      status: string;
      storageRevision?: number;
    } | null>;
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
  context?: JobContext,
): Promise<boolean> => {
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
    return false;
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
      storageRevision: true,
    } as object,
  });

  if (!file || file.deletedAt !== null) {
    throw new Error(`File ${payload.fileId} not found or deleted.`);
  }

  if (!file.mimeType.startsWith("video/")) {
    return false;
  }

  const kind =
    payload.kind === DERIVATIVE_KIND_POSTER
      ? DERIVATIVE_KIND_POSTER
      : DERIVATIVE_KIND_PREVIEW;
  const profile =
    kind === DERIVATIVE_KIND_POSTER
      ? DERIVATIVE_PROFILE_SOCIAL_JPEG
      : DERIVATIVE_PROFILE_1080P;
  const isPoster = kind === DERIVATIVE_KIND_POSTER;

  if (
    !isPoster &&
    payload.reason !== "manual-regenerate" &&
    file.sizeBytes < settings.mediaPreviewThresholdBytes
  ) {
    return false;
  }

  const derivative = await upsertDerivativeQueued(file.id, kind, profile);
  const publishMutationId = `derivative-publish-${derivative.id}-${job.id}`;
  if ((await assertWorkerMutationMayStart(publishMutationId)) === "succeeded") {
    return false;
  }

  await (getPrisma() as unknown as PrismaClient).mediaDerivative.update({
    where: { id: derivative.id },
    data: { status: DERIVATIVE_STATUS_PROCESSING, error: null } as object,
  });

  const inputPath = safeResolveStoragePath(
    storagePaths.filesRoot,
    file.storageKey,
  );
  const blockingInputMutation = await findBlockingStorageMutationForEntity({
    entityType: "file",
    entityId: file.id,
  });
  if (blockingInputMutation) {
    throw new StorageMutationOwnedError(
      blockingInputMutation.mutation.id,
      new Error("Source file has an unfinished storage mutation."),
    );
  }
  const storageKey = buildDerivativeStorageKey(
    file.ownerUserId,
    file.id,
    profile,
  );
  const outputPath = safeResolveStoragePath(storagePaths.filesRoot, storageKey);
  const tmpDir = path.resolve(storagePaths.tmpRoot, "derivatives");
  const tmpPath = path.resolve(
    tmpDir,
    `${derivative.id}.${isPoster ? "jpg" : "mp4"}.tmp`,
  );

  await mkdir(tmpDir, { recursive: true });

  await context?.updateProgress({ stage: "probing", fileId: file.id });

  let probe;
  try {
    probe = await runFfprobe(inputPath);
  } catch (err) {
    await markDerivativeFailed(derivative.id, String(err));
    throw err;
  }

  let cancelledByAdmin = false;
  const controller = new AbortController();
  const abortFromContext = () => {
    cancelledByAdmin = true;
    controller.abort();
  };
  context?.signal.addEventListener("abort", abortFromContext, { once: true });

  const cancelPollId = setInterval(() => {
    if (context?.signal.aborted) {
      cancelledByAdmin = true;
      controller.abort();
      return;
    }

    void (getPrisma() as unknown as PrismaClient).mediaDerivative
      .findUnique({
        where: { id: derivative.id },
        select: { status: true } as object,
      })
      .then((current) => {
        if (current?.status === DERIVATIVE_STATUS_STALE) {
          cancelledByAdmin = true;
          controller.abort();
        }
      })
      .catch(() => {
        // ignore transient DB errors during poll
      });
  }, 3000);

  try {
    await context?.updateProgress({
      stage: isPoster ? "capturing-poster" : "encoding",
      fileId: file.id,
    });
    if (isPoster) {
      await runFfmpegPoster(inputPath, tmpPath, controller.signal);
    } else if (isStreamCopyCompatible(probe)) {
      await runFfmpegStreamCopy(inputPath, tmpPath, controller.signal);
    } else {
      await runFfmpegTranscode(
        inputPath,
        tmpPath,
        settings.mediaPreviewMaxHeight,
        settings.mediaPreviewCrf,
        controller.signal,
      );
    }
  } catch (err) {
    await rm(tmpPath, { force: true });
    if (cancelledByAdmin) {
      return true;
    }
    await markDerivativeFailed(derivative.id, String(err));
    throw err;
  } finally {
    clearInterval(cancelPollId);
    context?.signal.removeEventListener("abort", abortFromContext);
  }

  try {
    await context?.updateProgress({ stage: "committing", fileId: file.id });
    await access(tmpPath);
  } catch (err) {
    await rm(tmpPath, { force: true });
    await markDerivativeFailed(derivative.id, String(err));
    throw err;
  }

  const outputStats = await stat(tmpPath);
  const outputProbe = await runFfprobe(tmpPath);
  const visualStream = outputProbe.streams.find(
    (s) => s.codec_type === "video",
  );
  const audioStream = isPoster
    ? null
    : outputProbe.streams.find((s) => s.codec_type === "audio");
  const durationSeconds =
    !isPoster && outputProbe.format.duration
      ? parseFloat(outputProbe.format.duration)
      : null;

  // Guard: admin may have marked stale while we were processing.
  const current = await (
    getPrisma() as unknown as PrismaClient
  ).mediaDerivative.findUnique({
    where: { id: derivative.id },
    select: { status: true } as object,
  });
  if (current?.status === DERIVATIVE_STATUS_STALE) {
    await rm(tmpPath, { force: true });
    return true;
  }

  const tmpKey = path
    .relative(storagePaths.filesRoot, tmpPath)
    .split(path.sep)
    .join("/");
  const newChecksum = await calculateStorageFileChecksum(
    storagePaths.filesRoot,
    tmpKey,
  );
  let oldChecksum: string | null = null;
  try {
    oldChecksum = await calculateStorageFileChecksum(
      storagePaths.filesRoot,
      storageKey,
    );
  } catch {
    oldChecksum = null;
  }
  const generatedAt = job.createdAt;
  const readyData = {
    storageKey,
    mimeType: isPoster ? "image/jpeg" : "video/mp4",
    sizeBytes: String(outputStats.size),
    width: visualStream?.width ?? null,
    height: visualStream?.height ?? null,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    videoCodec: isPoster ? null : (visualStream?.codec_name ?? null),
    audioCodec: audioStream?.codec_name ?? null,
    generatedAt: generatedAt.toISOString(),
    status: "ready",
    error: null,
  };
  await runWorkerStorageMutation({
    mutationId: publishMutationId,
    kind: "derivative_publish",
    ownerUserId: file.ownerUserId,
    idempotencyKey: `derivative-publish:${job.id}`,
    storagePaths,
    metadataOperations: [
      {
        action: "update",
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision ?? 0,
        data: readyData,
      },
    ],
    steps: buildArtifactPublishSteps({
      mutationId: publishMutationId,
      tmpKey,
      storageKey,
      sizeBytes: BigInt(outputStats.size),
      checksum: newChecksum,
      oldChecksum,
    }),
    entities: [
      {
        entityType: "file",
        entityId: file.id,
        preRevision: file.storageRevision,
        postRevision: file.storageRevision,
        beforeJson: null,
        afterJson: null,
      },
      {
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: derivative.storageRevision ?? 0,
        postRevision: (derivative.storageRevision ?? 0) + 1,
        beforeJson: { status: derivative.status },
        afterJson: readyData,
      },
    ],
  });

  await context?.updateProgress({ stage: "ready", fileId: file.id });

  return false;
};
