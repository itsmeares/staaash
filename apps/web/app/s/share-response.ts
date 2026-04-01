import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { getStoragePath } from "@/server/storage";
import type { ShareDownloadResult } from "@/server/sharing";
import { ShareError, isShareError } from "@/server/sharing";

const buildAttachmentDisposition = (fileName: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export const createFileDownloadResponse = ({
  file,
  contentType,
  contentLength,
}: ShareDownloadResult) =>
  new Response(
    Readable.toWeb(createReadStream(getStoragePath(file.storageKey))) as ReadableStream,
    {
      headers: {
        "content-disposition": buildAttachmentDisposition(file.name),
        "content-length": String(contentLength),
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    },
  );

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
