import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const FRAME_TIMEOUT_MS = 2 * 60_000;
const PROBE_TIMEOUT_MS = 60_000;
const KILL_GRACE_MS = 5_000;

const runFfmpegProcess = (
  args: string[],
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const proc = spawn(
      "ffmpeg",
      ["-nostdin", "-threads", "1", "-filter_threads", "1", ...args],
      { stdio: "ignore" },
    );
    let stopped = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = () => {
      if (stopped) return;
      stopped = true;
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            terminate();
          }, timeoutMs);
    signal?.addEventListener("abort", terminate, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", terminate);
    };
    proc.on("close", (code) => {
      cleanup();
      if (stopped) {
        reject(
          new DOMException(
            timedOut ? "ffmpeg timed out." : "ffmpeg aborted.",
            timedOut ? "TimeoutError" : "AbortError",
          ),
        );
      } else if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${String(code)}.`));
    });
    proc.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });

export type FfmpegHealth = {
  available: boolean;
  ffmpegVersion: string | null;
  ffprobeVersion: string | null;
  lastProbeError: string | null;
};

let _health: FfmpegHealth | null = null;

const parseVersionLine = (output: string): string | null => {
  const match = output.match(/version\s+(\S+)/);
  return match?.[1] ?? null;
};

export const detectFfmpeg = async (): Promise<FfmpegHealth> => {
  const [ffmpegResult, ffprobeResult] = await Promise.allSettled([
    execFileAsync("ffmpeg", ["-version"], {
      timeout: 10_000,
      killSignal: "SIGKILL",
    }),
    execFileAsync("ffprobe", ["-version"], {
      timeout: 10_000,
      killSignal: "SIGKILL",
    }),
  ]);

  const ffmpegOk = ffmpegResult.status === "fulfilled";
  const ffprobeOk = ffprobeResult.status === "fulfilled";

  const health: FfmpegHealth = {
    available: ffmpegOk && ffprobeOk,
    ffmpegVersion: ffmpegOk
      ? parseVersionLine(ffmpegResult.value.stdout)
      : null,
    ffprobeVersion: ffprobeOk
      ? parseVersionLine(ffprobeResult.value.stdout)
      : null,
    lastProbeError: !ffmpegOk
      ? String((ffmpegResult as PromiseRejectedResult).reason)
      : !ffprobeOk
        ? String((ffprobeResult as PromiseRejectedResult).reason)
        : null,
  };

  _health = health;
  return health;
};

export const getFfmpegHealth = (): FfmpegHealth =>
  _health ?? {
    available: false,
    ffmpegVersion: null,
    ffprobeVersion: null,
    lastProbeError: "FFmpeg detection has not been run yet.",
  };

type FfprobeStream = {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};

type FfprobeFormat = {
  duration?: string;
};

export type FfprobeResult = {
  streams: FfprobeStream[];
  format: FfprobeFormat;
};

export const runFfprobe = async (
  inputPath: string,
  signal?: AbortSignal,
): Promise<FfprobeResult> => {
  signal?.throwIfAborted();
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-threads",
      "1",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      inputPath,
    ],
    { signal, timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL" },
  );
  return JSON.parse(stdout) as FfprobeResult;
};

const getDisplayedHeight = (video: FfprobeStream) => {
  const rotation =
    video.side_data_list?.find((data) => data.rotation !== undefined)
      ?.rotation ?? Number(video.tags?.rotate ?? 0);
  return Math.abs(rotation) % 180 === 90 ? video.width : video.height;
};

export const isStreamCopyCompatible = (
  probe: FfprobeResult,
  maxHeight: number,
): boolean => {
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  if (!video || video.codec_name !== "h264") return false;
  if (audio && audio.codec_name !== "aac") return false;
  // Copying preserves rotation, so compare the displayed height with the cap.
  const height = getDisplayedHeight(video);
  return height !== undefined && height <= maxHeight;
};

export const runFfmpegStreamCopy = (
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> =>
  runFfmpegProcess(
    [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ],
    signal,
  );

export const runFfmpegTranscode = (
  inputPath: string,
  outputPath: string,
  maxHeight: number,
  crf: number,
  signal?: AbortSignal,
): Promise<void> =>
  runFfmpegProcess(
    [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-vf",
      `scale=-2:min(ih\\,${maxHeight}):force_original_aspect_ratio=decrease`,
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-preset",
      "medium",
      "-crf",
      String(crf),
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-f",
      "mp4",
      outputPath,
    ],
    signal,
  );

const runFfmpegPosterFrame = (
  inputPath: string,
  outputPath: string,
  seekSeconds: number,
  signal?: AbortSignal,
): Promise<void> =>
  runFfmpegProcess(
    [
      "-y",
      "-ss",
      String(seekSeconds),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-vf",
      "scale=min(1280\\,iw):-2",
      "-q:v",
      "2",
      "-f",
      "image2",
      outputPath,
    ],
    signal,
    FRAME_TIMEOUT_MS,
  );

export const runFfmpegPoster = async (
  inputPath: string,
  outputPath: string,
  signal?: AbortSignal,
): Promise<void> => {
  try {
    await runFfmpegPosterFrame(inputPath, outputPath, 1, signal);
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "TimeoutError")
    )
      throw error;
    await runFfmpegPosterFrame(inputPath, outputPath, 0, signal);
  }
};

const runFfmpegThumbnailFrame = (
  inputPath: string,
  outputPath: string,
  seekSeconds: number | null,
  signal?: AbortSignal,
): Promise<void> =>
  runFfmpegProcess(
    [
      "-y",
      ...(seekSeconds === null ? [] : ["-ss", String(seekSeconds)]),
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-threads",
      "1",
      "-vf",
      "scale=480:480:force_original_aspect_ratio=decrease",
      "-q:v",
      "4",
      "-f",
      "image2",
      outputPath,
    ],
    signal,
    FRAME_TIMEOUT_MS,
  );

/**
 * A 480px JPEG: the picture itself, a music file's album art, or a frame one
 * second into a video.
 */
export const runFfmpegThumbnail = async (
  inputPath: string,
  outputPath: string,
  isVideo: boolean,
  signal?: AbortSignal,
): Promise<void> => {
  if (!isVideo) {
    await runFfmpegThumbnailFrame(inputPath, outputPath, null, signal);
    return;
  }
  try {
    await runFfmpegThumbnailFrame(inputPath, outputPath, 1, signal);
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "TimeoutError")
    )
      throw error;
    // Videos shorter than a second have no frame there.
    await runFfmpegThumbnailFrame(inputPath, outputPath, 0, signal);
  }
};
