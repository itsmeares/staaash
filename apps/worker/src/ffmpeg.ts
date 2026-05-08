import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const runFfmpegProcess = (
  args: string[],
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "ignore" });

    let killedBySignal = false;

    const onAbort = () => {
      killedBySignal = true;
      proc.kill();
    };

    if (signal?.aborted) {
      proc.kill();
      killedBySignal = true;
    } else if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    proc.on("close", (code) => {
      if (signal) signal.removeEventListener("abort", onAbort);
      if (killedBySignal) {
        reject(
          Object.assign(new Error("ffmpeg aborted."), { code: "ABORT_ERR" }),
        );
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${String(code)}.`));
      }
    });

    proc.on("error", reject);
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
    execFileAsync("ffmpeg", ["-version"]),
    execFileAsync("ffprobe", ["-version"]),
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
};

type FfprobeFormat = {
  duration?: string;
};

export type FfprobeResult = {
  streams: FfprobeStream[];
  format: FfprobeFormat;
};

export const runFfprobe = async (inputPath: string): Promise<FfprobeResult> => {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    inputPath,
  ]);
  return JSON.parse(stdout) as FfprobeResult;
};

export const isStreamCopyCompatible = (probe: FfprobeResult): boolean => {
  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  if (!video) return false;
  return video.codec_name === "h264" && (!audio || audio.codec_name === "aac");
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
