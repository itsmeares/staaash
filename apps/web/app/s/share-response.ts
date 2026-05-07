import { getStoragePath } from "@/server/storage";
import { createRangeResponseFromPath } from "@/server/downloads/range-response";
import { ShareError, isShareError } from "@/server/sharing/errors";
import type { ShareDownloadResult } from "@/server/sharing/types";

const buildAttachmentDisposition = (fileName: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export const createFileDownloadResponse = async (
  { file, contentType, contentLength }: ShareDownloadResult,
  request: Request,
): Promise<Response> => {
  const response = await createRangeResponseFromPath(
    request,
    getStoragePath(file.storageKey),
    contentLength,
    contentType,
    file.name,
  );
  if (!response) {
    return new Response("File not found.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return response;
};

export const createArchiveResponse = ({
  fileName,
  stream,
}: {
  fileName: string;
  stream: ReadableStream;
}) =>
  new Response(stream, {
    headers: {
      "content-disposition": buildAttachmentDisposition(fileName),
      "content-type": "application/zip",
      "x-content-type-options": "nosniff",
    },
  });

export const createShareErrorResponse = (error: unknown) => {
  const normalized = isShareError(error)
    ? error
    : new ShareError("SHARE_INVALID");

  return new Response(normalized.message, {
    status: normalized.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
};
