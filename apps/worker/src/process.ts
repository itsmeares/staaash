import { spawn } from "node:child_process";

const KILL_GRACE_MS = 5_000;
const STDERR_TAIL = 4096;

export type ProcessResult = {
  code: number | null;
  stdout: Buffer;
  /** The end of what the program wrote to stderr. */
  stderr: string;
  /** Output reached maxOutputBytes, so the program was stopped. */
  cut: boolean;
};

/**
 * Runs a program to its end. A timeout or abort stops it with SIGTERM, then
 * SIGKILL, and rejects with a TimeoutError or AbortError once it exits.
 * stdout is kept only with maxOutputBytes.
 */
export const runProcess = (
  command: string,
  args: string[],
  {
    signal,
    timeoutMs,
    input,
    maxOutputBytes,
    env,
  }: {
    signal?: AbortSignal;
    timeoutMs?: number;
    input?: Uint8Array;
    maxOutputBytes?: number;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ProcessResult> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const proc = spawn(command, args, {
      env,
      stdio: [
        input ? "pipe" : "ignore",
        maxOutputBytes === undefined ? "ignore" : "pipe",
        "pipe",
      ],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let stopped: "timeout" | "abort" | "cut" | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    const terminate = (reason: NonNullable<typeof stopped>) => {
      if (stopped) return;
      stopped = reason;
      proc.kill("SIGTERM");
      killTimer = setTimeout(() => proc.kill("SIGKILL"), KILL_GRACE_MS);
      killTimer.unref();
    };
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (stopped || maxOutputBytes === undefined) return;
      chunks.push(chunk.subarray(0, maxOutputBytes - size));
      size += chunk.length;
      if (size >= maxOutputBytes) terminate("cut");
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    if (input) {
      // The program may exit before reading all of it.
      proc.stdin?.on("error", () => undefined);
      proc.stdin?.end(input);
    }
    const timeout =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => terminate("timeout"), timeoutMs);
    const onAbort = () => terminate("abort");
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    proc.on("close", (code) => {
      cleanup();
      if (stopped === "timeout" || stopped === "abort") {
        reject(
          new DOMException(
            `${command} ${stopped === "timeout" ? "timed out" : "aborted"}.`,
            stopped === "timeout" ? "TimeoutError" : "AbortError",
          ),
        );
      } else {
        resolve({
          code,
          stdout: Buffer.concat(chunks),
          stderr,
          cut: stopped === "cut",
        });
      }
    });
    proc.on("error", (error) => {
      cleanup();
      reject(error);
    });
  });
