import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundJobRecord } from "@staaash/db/jobs";

const mocks = vi.hoisted(() => ({
  buildDerivativeStorageKey: vi.fn(),
  getFfmpegHealth: vi.fn(),
  getPrisma: vi.fn(),
  isStreamCopyCompatible: vi.fn(),
  markDerivativeFailed: vi.fn(),
  markDerivativeReady: vi.fn(),
  runFfmpegStreamCopy: vi.fn(),
  runFfmpegTranscode: vi.fn(),
  runFfprobe: vi.fn(),
  upsertDerivativeQueued: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@staaash/db/media-derivatives", () => ({
  DERIVATIVE_KIND_PREVIEW: "preview",
  DERIVATIVE_PROFILE_1080P: "preview-1080p",
  DERIVATIVE_STATUS_PROCESSING: "processing",
  DERIVATIVE_STATUS_STALE: "stale",
  buildDerivativeStorageKey: mocks.buildDerivativeStorageKey,
  markDerivativeFailed: mocks.markDerivativeFailed,
  markDerivativeReady: mocks.markDerivativeReady,
  upsertDerivativeQueued: mocks.upsertDerivativeQueued,
}));

vi.mock("../ffmpeg.js", () => ({
  getFfmpegHealth: mocks.getFfmpegHealth,
  isStreamCopyCompatible: mocks.isStreamCopyCompatible,
  runFfmpegStreamCopy: mocks.runFfmpegStreamCopy,
  runFfmpegTranscode: mocks.runFfmpegTranscode,
  runFfprobe: mocks.runFfprobe,
}));

const { handleMediaDerivativeGenerate } = await import("./media-derivative.js");

const fixedNow = new Date("2026-05-31T12:00:00.000Z");

const createJob = (): BackgroundJobRecord => ({
  id: "job-1",
  kind: "media.derivative.generate",
  status: "running",
  payloadJson: {
    fileId: "file-1",
    kind: "preview",
    profile: "preview-1080p",
    reason: "share-created",
  },
  dedupeKey: "media.derivative.generate:file-1:preview:preview-1080p",
  runAt: fixedNow,
  lockedAt: null,
  lockedBy: null,
  attemptCount: 1,
  maxAttempts: 5,
  lastError: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
});

describe("media derivative handler", () => {
  let tempRoot: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFfmpegHealth.mockReturnValue({
      available: true,
      ffmpegVersion: "7.1",
      ffprobeVersion: "7.1",
      lastProbeError: null,
    });
    mocks.buildDerivativeStorageKey.mockReturnValue(
      "derivatives/owner-1/file-1/preview-1080p.mp4",
    );
    mocks.isStreamCopyCompatible.mockReturnValue(false);
    mocks.upsertDerivativeQueued.mockResolvedValue({
      id: "derivative-1",
      status: "queued",
    });
    mocks.markDerivativeReady.mockResolvedValue({
      id: "derivative-1",
      status: "ready",
    });
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("stores dimensions from the generated output instead of the source", async () => {
    tempRoot = await mkdtemp(
      path.join(os.tmpdir(), "staaash-media-derivative-"),
    );
    const filesRoot = path.join(tempRoot, "files");
    const tmpRoot = path.join(tempRoot, "tmp");
    const sourcePath = path.join(filesRoot, "library", "owner-1", "clip.mov");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, "source", "utf8");

    const client = {
      systemSettings: {
        findUnique: vi.fn(async () => ({
          mediaPreviewEnabled: true,
          mediaPreviewThresholdBytes: 1n,
          mediaPreviewMaxHeight: 720,
          mediaPreviewCrf: 22,
        })),
      },
      file: {
        findUnique: vi.fn(async () => ({
          id: "file-1",
          ownerUserId: "owner-1",
          mimeType: "video/quicktime",
          sizeBytes: 10_000n,
          storageKey: "library/owner-1/clip.mov",
          deletedAt: null,
        })),
      },
      mediaDerivative: {
        update: vi.fn(async () => ({
          id: "derivative-1",
          status: "processing",
        })),
        findUnique: vi.fn(async () => ({
          id: "derivative-1",
          status: "processing",
        })),
      },
    };
    mocks.getPrisma.mockReturnValue(client);

    mocks.runFfprobe.mockImplementation(async (inputPath: string) => {
      if (inputPath.endsWith("preview-1080p.mp4")) {
        return {
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 1280,
              height: 720,
            },
            { codec_type: "audio", codec_name: "aac" },
          ],
          format: { duration: "12.5" },
        };
      }

      return {
        streams: [
          {
            codec_type: "video",
            codec_name: "hevc",
            width: 3840,
            height: 2160,
          },
        ],
        format: { duration: "12.5" },
      };
    });

    mocks.runFfmpegTranscode.mockImplementation(
      async (_inputPath: string, outputPath: string) => {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, "output", "utf8");
      },
    );

    await expect(
      handleMediaDerivativeGenerate(createJob(), {
        filesRoot,
        tmpRoot,
        heartbeatPath: path.join(tmpRoot, "worker-heartbeat.json"),
        pendingDeleteRoot: path.join(tmpRoot, "pending-delete"),
        uploadStagingTtlMs: 1,
      }),
    ).resolves.toBe(false);

    expect(mocks.runFfprobe).toHaveBeenCalledWith(sourcePath);
    expect(mocks.runFfprobe).toHaveBeenCalledWith(
      path.join(
        filesRoot,
        "derivatives",
        "owner-1",
        "file-1",
        "preview-1080p.mp4",
      ),
    );
    expect(mocks.markDerivativeReady).toHaveBeenCalledWith(
      "derivative-1",
      expect.objectContaining({
        mimeType: "video/mp4",
        width: 1280,
        height: 720,
        durationSeconds: 12.5,
        videoCodec: "h264",
        audioCodec: "aac",
      }),
    );
  });
});
