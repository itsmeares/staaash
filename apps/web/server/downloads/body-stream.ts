import type { Readable } from "node:stream";

// Wraps a Node.js Readable as a Web ReadableStream with backpressure and safe error handling.
// Readable.toWeb() does not guard controller.enqueue/close against ERR_INVALID_STATE
// when the consumer cancels mid-stream (common with video range requests).
// Using pull() + pause/resume to avoid unbounded memory growth with large files.
export const nodeBodyStream = (
  readable: Readable,
  signal: AbortSignal,
  extraCleanup?: () => Promise<void> | void,
): ReadableStream<Uint8Array> => {
  let cleanupPromise: Promise<void> | null = null;
  const cleanup = () => {
    cleanupPromise ??= Promise.resolve()
      .then(() => extraCleanup?.())
      .then(() => undefined)
      .catch(() => undefined);
    return cleanupPromise;
  };
  const destroy = async () => {
    readable.destroy();
    await cleanup();
  };

  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        readable.on("data", (chunk: Buffer) => {
          try {
            controller.enqueue(
              new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
            );
          } catch {
            void destroy();
            return;
          }
          if ((controller.desiredSize ?? 1) <= 0) {
            readable.pause();
          }
        });
        readable.on("end", () => {
          try {
            controller.close();
          } catch {
            // already closed
          }
          void cleanup();
        });
        readable.on("error", (err) => {
          try {
            controller.error(err);
          } catch {
            // already closed/errored
          }
          void cleanup();
        });
        readable.on("close", () => {
          void cleanup();
        });
        signal.addEventListener(
          "abort",
          () => {
            void destroy();
          },
          { once: true },
        );
      },
      pull() {
        readable.resume();
      },
      cancel() {
        return destroy();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 512 * 1024 }),
  );
};
