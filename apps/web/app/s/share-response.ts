import { getStoragePath } from "@/server/storage";
import { createRangeResponseFromPath } from "@/server/downloads/range-response";
import { prismaFilesRepository } from "@/server/files/repository";
import { ShareError, isShareError } from "@/server/sharing/errors";
import type { ShareDownloadResult } from "@/server/sharing/types";
import {
  assertStorageEntityReadable,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

const buildAttachmentDisposition = (fileName: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;

export const createFileDownloadResponse = async (
  { file, contentType, contentLength }: ShareDownloadResult,
  request: Request,
): Promise<Response> => {
  await assertStorageEntityReadable("file", file.id);
  const response = await createRangeResponseFromPath(
    request,
    getStoragePath(file.storageKey),
    contentLength,
    contentType,
    file.name,
    {
      onMissingStorageObject: () =>
        prismaFilesRepository.markFileStorageMissing(file.id),
    },
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
  if (error instanceof StorageEntityUnavailableError) {
    return new Response(error.message, {
      status: error.status,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "X-Storage-Mutation-Id": error.mutationId,
      },
    });
  }
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
