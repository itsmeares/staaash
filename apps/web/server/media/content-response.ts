import { open } from "node:fs/promises";
import type { Readable } from "node:stream";

import { getStoragePath } from "@/server/storage";
import { prismaFilesRepository } from "@/server/files/repository";
import type { StoredFile } from "@/server/files/types";
import { convertHeicToJpeg } from "./heic-converter";

const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_EXTENSIONS = new Set(["heic", "heif"]);

const isHeicFile = (file: Pick<StoredFile, "mimeType" | "name">): boolean => {
  if (
    HEIC_MIME_TYPES.has(file.mimeType.split(";")[0]?.trim().toLowerCase() ?? "")
  )
    return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return HEIC_EXTENSIONS.has(ext);
};

const buildInlineDisposition = (fileName: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;

type ByteRange = {
  start: number;
  end: number;
};

export class MediaContentError extends Error {
  readonly status: number;
  readonly headers: HeadersInit | undefined;

  constructor(
    status: number,
    message: string,
    options?: {
      headers?: HeadersInit;
    },
  ) {
    super(message);
    this.name = "MediaContentError";
    this.status = status;
    this.headers = options?.headers;
  }
}

const parseSingleRange = (
  rangeHeader: string,
  sizeBytes: number,
): ByteRange => {
  if (!rangeHeader.startsWith("bytes=")) {
    throw new MediaContentError(416, "Malformed range request.", {
      headers: {
        "content-range": `bytes */${sizeBytes}`,
      },
    });
  }

  const requestedRange = rangeHeader.slice("bytes=".length).trim();

  if (requestedRange.length === 0 || requestedRange.includes(",")) {
    throw new MediaContentError(416, "Only a single byte range is supported.", {
      headers: {
        "content-range": `bytes */${sizeBytes}`,
      },
    });
  }

  const [startToken, endToken] = requestedRange.split("-", 2);

  if (startToken === undefined || endToken === undefined) {
    throw new MediaContentError(416, "Malformed range request.", {
      headers: {
        "content-range": `bytes */${sizeBytes}`,
      },
    });
  }

  if (startToken === "") {
    const suffixLength = Number(endToken);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw new MediaContentError(416, "Malformed range request.", {
        headers: {
          "content-range": `bytes */${sizeBytes}`,
        },
      });
    }

    const start = Math.max(sizeBytes - suffixLength, 0);

    return {
      start,
      end: sizeBytes - 1,
    };
  }

  const start = Number(startToken);

  if (!Number.isInteger(start) || start < 0 || start >= sizeBytes) {
    throw new MediaContentError(416, "Requested range is out of bounds.", {
      headers: {
        "content-range": `bytes */${sizeBytes}`,
      },
    });
  }

  if (endToken === "") {
    return {
      start,
      end: sizeBytes - 1,
    };
  }

  const requestedEnd = Number(endToken);

  if (!Number.isInteger(requestedEnd) || requestedEnd < start) {
    throw new MediaContentError(416, "Malformed range request.", {
      headers: {
        "content-range": `bytes */${sizeBytes}`,
      },
    });
  }

  return {
    start,
    end: Math.min(requestedEnd, sizeBytes - 1),
  };
};

const createBaseHeaders = (file: StoredFile): HeadersInit => ({
  "cache-control": "private, max-age=0, must-revalidate",
  "content-disposition": buildInlineDisposition(file.name),
  "content-type": file.mimeType || "application/octet-stream",
  "x-content-type-options": "nosniff",
});

export const createMediaErrorResponse = (error: MediaContentError) =>
  new Response(error.message, {
    status: error.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      ...error.headers,
    },
  });

const isMissingStorageObject = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EISDIR";
};

// Wraps a Node.js Readable as a Web ReadableStream with backpressure and safe error handling.
// Readable.toWeb() does not guard controller.enqueue/close against ERR_INVALID_STATE
// when the consumer cancels mid-stream (common with video range requests).
// Using pull() + pause/resume to avoid unbounded memory growth with large files.
const toWebStream = (
  readable: Readable,
  signal: AbortSignal,
  extraCleanup?: () => void,
): ReadableStream<Uint8Array> => {
  const destroy = () => {
    readable.destroy();
    extraCleanup?.();
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
            destroy();
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
        });
        readable.on("error", (err) => {
          try {
            controller.error(err);
          } catch {
            // already closed/errored
          }
        });
        signal.addEventListener("abort", destroy, { once: true });
      },
      pull() {
        readable.resume();
      },
      cancel() {
        destroy();
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 512 * 1024 }),
  );
};

export const createInlineOriginalContentResponse = async ({
  request,
  file,
}: {
  request: Request;
  file: StoredFile;
}): Promise<Response> => {
  if (!file.viewerKind) {
    throw new MediaContentError(
      404,
      "Inline viewing is not supported for this file type.",
    );
  }

  const storagePath = getStoragePath(file.storageKey);

  let fileHandle;

  try {
    fileHandle = await open(storagePath, "r");
  } catch (error) {
    if (isMissingStorageObject(error)) {
      await prismaFilesRepository.markFileStorageMissing(file.id);
    }

    throw new MediaContentError(404, "File content is unavailable.");
  }

  let streamCreated = false;

  try {
    const stat = await fileHandle.stat();

    const createStream = (options?: { start: number; end: number }) => {
      const nodeStream = fileHandle.createReadStream({
        ...options,
        highWaterMark: 512 * 1024,
      });
      streamCreated = true;
      nodeStream.on("close", () => {
        fileHandle.close().catch(() => {});
      });
      return toWebStream(nodeStream, request.signal);
    };

    if (file.viewerKind === "image") {
      if (isHeicFile(file)) {
        const inputBuffer = await fileHandle.readFile();
        streamCreated = true;
        await fileHandle.close().catch(() => {});
        const outputBuffer = await convertHeicToJpeg(inputBuffer);
        return new Response(outputBuffer, {
          status: 200,
          headers: {
            ...createBaseHeaders(file),
            "content-type": "image/jpeg",
            "content-length": String(outputBuffer.byteLength),
          },
        });
      }

      return new Response(createStream(), {
        status: 200,
        headers: {
          ...createBaseHeaders(file),
          "content-length": String(stat.size),
        },
      });
    }

    const rangeHeader = request.headers.get("range");
    const baseHeaders = {
      ...createBaseHeaders(file),
      "accept-ranges": "bytes",
    };

    if (!rangeHeader) {
      return new Response(createStream(), {
        status: 200,
        headers: {
          ...baseHeaders,
          "content-length": String(stat.size),
        },
      });
    }

    const { start, end } = parseSingleRange(rangeHeader, stat.size);
    const contentLength = end - start + 1;

    return new Response(createStream({ start, end }), {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-length": String(contentLength),
        "content-range": `bytes ${start}-${end}/${stat.size}`,
      },
    });
  } catch (error) {
    if (!streamCreated) {
      try {
        await fileHandle.close();
      } catch {
        // Ignore secondary close failures and preserve the original error.
      }
    }

    throw error;
  }
};
