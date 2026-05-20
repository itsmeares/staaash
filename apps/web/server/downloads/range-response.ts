import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

const buildAttachmentDisposition = (fileName: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;

const parseSingleByteRange = (
  rangeHeader: string,
  size: number,
): { start: number; end: number } | null => {
  if (!rangeHeader.startsWith("bytes=")) return null;
  const part = rangeHeader.slice("bytes=".length).trim();
  if (!part || part.includes(",")) return null;
  const [s, e] = part.split("-", 2);
  if (s === undefined || e === undefined) return null;
  if (s === "") {
    const suffix = Number(e);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(s);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;
  const end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
};

export const createRangeResponseFromHandle = (
  request: Request,
  fileHandle: FileHandle,
  sizeBytes: number,
  mimeType: string,
  fileName: string,
): Response => {
  const rangeHeader = request.headers.get("range");
  const baseHeaders: Record<string, string> = {
    "content-disposition": buildAttachmentDisposition(fileName),
    "content-type": mimeType,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  };

  const createStream = (options?: { start: number; end: number }) => {
    const nodeStream = fileHandle.createReadStream({
      ...options,
      highWaterMark: 512 * 1024,
    });
    nodeStream.on("close", () => {
      fileHandle.close().catch(() => {});
    });
    return nodeStream as unknown as ReadableStream;
  };

  if (!rangeHeader) {
    return new Response(createStream(), {
      status: 200,
      headers: { ...baseHeaders, "content-length": String(sizeBytes) },
    });
  }

  const range = parseSingleByteRange(rangeHeader, sizeBytes);
  if (!range) {
    void fileHandle.close().catch(() => {});
    return new Response("Range not satisfiable.", {
      status: 416,
      headers: {
        "content-range": `bytes */${sizeBytes}`,
        "content-type": "text/plain; charset=utf-8",
      },
    });
  }

  const { start, end } = range;
  return new Response(createStream({ start, end }), {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${sizeBytes}`,
    },
  });
};

export const createRangeResponseFromPath = async (
  request: Request,
  storagePath: string,
  sizeBytes: number,
  mimeType: string,
  fileName: string,
  options: {
    onMissingStorageObject?: () => Promise<void> | void;
  } = {},
): Promise<Response | null> => {
  let fileHandle: FileHandle;
  try {
    fileHandle = await open(storagePath, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (code === "ENOENT" || code === "EISDIR") {
      await options.onMissingStorageObject?.();
    }
    return null;
  }
  try {
    return createRangeResponseFromHandle(
      request,
      fileHandle,
      sizeBytes,
      mimeType,
      fileName,
    );
  } catch (error) {
    await fileHandle.close().catch(() => {});
    throw error;
  }
};
