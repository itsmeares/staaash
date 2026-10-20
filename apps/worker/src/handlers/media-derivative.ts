import path from "node:path";
import { access, mkdir, rm, stat } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { StorageAdmissionCancelledError } from "@staaash/db/storage-transactions";
import {
  DERIVATIVE_KIND_POSTER,
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_1080P,
  DERIVATIVE_PROFILE_SOCIAL_JPEG,
  DERIVATIVE_PROFILE_THUMB,
  DERIVATIVE_STATUS_FAILED,
  DERIVATIVE_STATUS_PROCESSING,
  DERIVATIVE_STATUS_STALE,
  buildDerivativeStorageKey,
  canHaveThumbnail,
  settleDerivativeIfOwned,
  upsertDerivativeQueued,
} from "@staaash/db/media-derivatives";
import { calculateStorageFileChecksum } from "@staaash/db/storage-mutation-executor";
import {
  findBlockingStorageMutationForEntity,
  findStorageMutationByIdempotencyKey,
} from "@staaash/db/storage-mutations";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import type { JobContext } from "../job-context.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";
import {
  getFfmpegHealth,
  isStreamCopyCompatible,
  runFfmpegPoster,
  runFfmpegStreamCopy,
  runFfmpegThumbnail,
  runFfmpegTranscode,
  runFfprobe,
} from "../ffmpeg.js";
import {
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

// fallow-ignore-next-line complexity
export const handleMediaDerivativeGenerate = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
  context?: JobContext,
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
      storageRevision: true,
    } as object,
  });

  if (!file || file.deletedAt !== null) {
    throw new Error(`File ${payload.fileId} not found or deleted.`);
  }

  const isThumbnail = payload.kind === DERIVATIVE_KIND_THUMBNAIL;
  const isVideo = file.mimeType.startsWith("video/");
  if (
    isThumbnail ? !canHaveThumbnail(file.mimeType, file.storageKey) : !isVideo
  ) {
    return;
  }

  const kind = isThumbnail
    ? DERIVATIVE_KIND_THUMBNAIL
    : payload.kind === DERIVATIVE_KIND_POSTER
      ? DERIVATIVE_KIND_POSTER
      : DERIVATIVE_KIND_PREVIEW;
  const profile = isThumbnail
    ? DERIVATIVE_PROFILE_THUMB
    : kind === DERIVATIVE_KIND_POSTER
      ? DERIVATIVE_PROFILE_SOCIAL_JPEG
      : DERIVATIVE_PROFILE_1080P;
  // Posters and thumbnails are single JPEG frames.
  const isPoster = kind !== DERIVATIVE_KIND_PREVIEW;

  if (
    kind === DERIVATIVE_KIND_PREVIEW &&
    payload.reason !== "manual-regenerate" &&
    file.sizeBytes < settings.mediaPreviewThresholdBytes
  ) {
    return;
  }

  const publication = await findStorageMutationByIdempotencyKey(
    `derivative-publish:${job.id}`,
  );
  if (publication) {
    if (publication.status === "succeeded") return;
    throw new StorageMutationOwnedError(publication.id);
  }

  const derivative = await upsertDerivativeQueued(
    file.id,
    kind,
    profile,
    job.id,
  );
  const publishMutationId = `derivative-publish-${derivative.id}-${job.id}`;

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
  safeResolveStoragePath(storagePaths.filesRoot, storageKey);
  const tmpDir = path.resolve(storagePaths.tmpRoot, "derivatives");
  const tmpPath = path.resolve(
    tmpDir,
    `${derivative.id}.${isPoster ? "jpg" : "mp4"}.tmp`,
  );

  await mkdir(tmpDir, { recursive: true });

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

  let outputStats;
  let outputProbe;
  try {
    if (context?.signal.aborted) abortFromContext();
    controller.signal.throwIfAborted();
    await context?.updateProgress({ stage: "probing", fileId: file.id });
    const probe = await runFfprobe(inputPath, controller.signal);
    if (
      isThumbnail &&
      file.mimeType.startsWith("audio/") &&
      !probe.streams.some((stream) => stream.codec_type === "video")
    ) {
      await settleDerivativeIfOwned(derivative.id, job.id, {
        status: DERIVATIVE_STATUS_FAILED,
        error: "No cover art in this file.",
      });
      return;
    }
    await context?.updateProgress({
      stage: isThumbnail
        ? "capturing-thumbnail"
        : isPoster
          ? "capturing-poster"
          : "encoding",
      fileId: file.id,
    });
    if (isThumbnail) {
      await runFfmpegThumbnail(inputPath, tmpPath, isVideo, controller.signal);
    } else if (isPoster) {
      await runFfmpegPoster(inputPath, tmpPath, controller.signal);
    } else if (isStreamCopyCompatible(probe, settings.mediaPreviewMaxHeight)) {
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
    await context?.updateProgress({ stage: "committing", fileId: file.id });
    await access(tmpPath);
    outputStats = await stat(tmpPath);
    outputProbe = await runFfprobe(tmpPath, controller.signal);
  } catch (err) {
    await rm(tmpPath, { force: true });
    if (cancelledByAdmin) {
      await settleDerivativeIfOwned(derivative.id, job.id, {
        status: DERIVATIVE_STATUS_STALE,
      });
      return;
    }
    await settleDerivativeIfOwned(derivative.id, job.id, {
      status: DERIVATIVE_STATUS_FAILED,
      error: String(err),
    });
    throw err;
  } finally {
    clearInterval(cancelPollId);
    context?.signal.removeEventListener("abort", abortFromContext);
  }

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
    return;
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
  if (context?.signal.aborted) {
    await rm(tmpPath, { force: true });
    await settleDerivativeIfOwned(derivative.id, job.id, {
      status: DERIVATIVE_STATUS_STALE,
    });
    return;
  }
  try {
    await runWorkerStorageMutation({
      mutationId: publishMutationId,
      kind: "derivative_publish",
      ownerUserId: file.ownerUserId,
      idempotencyKey: `derivative-publish:${job.id}`,
      storagePaths,
      signal: context?.signal,
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
  } catch (error) {
    if (!(error instanceof StorageAdmissionCancelledError)) throw error;
    await rm(tmpPath, { force: true });
    await settleDerivativeIfOwned(derivative.id, job.id, {
      status: DERIVATIVE_STATUS_STALE,
    });
    return;
  }

  await context?.updateProgress({ stage: "ready", fileId: file.id });
};
