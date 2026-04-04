import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import { getStoragePath } from "@/server/storage";
import type { StoredLibraryFile } from "@/server/library/types";

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

const createBaseHeaders = (file: StoredLibraryFile): HeadersInit => ({
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

export const createInlineOriginalContentResponse = async ({
  request,
  file,
}: {
  request: Request;
  file: StoredLibraryFile;
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
  } catch {
    throw new MediaContentError(404, "File content is unavailable.");
  }

  const stat = await fileHandle.stat();

  if (file.viewerKind === "image") {
    const nodeStream = fileHandle.createReadStream();

    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
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
    const nodeStream = fileHandle.createReadStream();

    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      status: 200,
      headers: {
        ...baseHeaders,
        "content-length": String(stat.size),
      },
    });
  }

  const { start, end } = parseSingleRange(rangeHeader, stat.size);
  const nodeStream = fileHandle.createReadStream({
    start,
    end,
  });
  const contentLength = end - start + 1;

  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(contentLength),
      "content-range": `bytes ${start}-${end}/${stat.size}`,
    },
  });
};
