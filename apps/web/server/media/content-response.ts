import { contentDisposition } from "@/server/downloads/content-disposition";
import { open } from "node:fs/promises";

import { nodeBodyStream } from "@/server/downloads/body-stream";
import { getStoragePath } from "@/server/storage";
import { prismaFilesRepository } from "@/server/files/repository";
import type { StoredFile } from "@/server/files/types";
import { assertStorageEntityReadable } from "@/server/storage-read-guard";
import { convertHeicToJpeg, isHeicFile } from "./heic-converter";
import {
  getPublicShareSafeInlineMimeType,
  PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
} from "./public-share-content-policy";

type ByteRange = {
  start: number;
  end: number;
};

export const INLINE_MEDIA_OPEN_ENDED_RANGE_BYTES = 2 * 1024 * 1024;

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

// One check per malformed Range header shape, in RFC order.
// fallow-ignore-next-line complexity
export const parseSingleByteRange = (
  rangeHeader: string,
  sizeBytes: number,
  options?: {
    openEndedRangeBytes?: number;
  },
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
      end: Math.min(
        start + (options?.openEndedRangeBytes ?? sizeBytes) - 1,
        sizeBytes - 1,
      ),
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
  "content-disposition": contentDisposition("inline", file.name),
  "content-type": file.mimeType || "application/octet-stream",
  "x-content-type-options": "nosniff",
  // HTML or SVG opened straight from this URL must not run scripts on the
  // drive's origin. The viewer shows images with <img>, where they never run.
  ...(getPublicShareSafeInlineMimeType(file.mimeType)
    ? {}
    : { "content-security-policy": PUBLIC_SHARE_CONTENT_SECURITY_POLICY }),
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

// Ranged, full, and refused inline responses each answer differently.
// fallow-ignore-next-line complexity
export const createInlineOriginalContentResponse = async ({
  request,
  file,
}: {
  request: Request;
  file: StoredFile;
}): Promise<Response> => {
  await assertStorageEntityReadable("file", file.id);
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
      return nodeBodyStream(nodeStream, request.signal, () =>
        fileHandle.close().catch(() => {}),
      );
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

    const { start, end } = parseSingleByteRange(rangeHeader, stat.size, {
      openEndedRangeBytes:
        file.viewerKind === "video"
          ? INLINE_MEDIA_OPEN_ENDED_RANGE_BYTES
          : undefined,
    });
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
