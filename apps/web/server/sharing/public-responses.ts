import type { Readable } from "node:stream";

import {
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_THUMB,
  findReadyDerivative,
  findReadyPosterDerivative,
} from "@staaash/db/media-derivatives";

import { nodeBodyStream } from "@/server/downloads/body-stream";
import { getStoragePath } from "@/server/storage";
import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import {
  createPublicReadyDerivativeContentResponse,
  createPublicShareContentResponse,
} from "@/server/media/public-share-content-response";
import { sharingService } from "@/server/sharing/service";
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

export const createArchiveResponse = (
  { fileName, stream }: { fileName: string; stream: Readable },
  signal: AbortSignal,
) =>
  new Response(nodeBodyStream(stream, signal), {
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

const posterNotFound = () =>
  new MediaContentError(404, "Poster content is unavailable.");

const createPosterFileName = (fileName: string) => `${fileName}.jpg`;

export const createPosterErrorResponse = () =>
  createMediaErrorResponse(posterNotFound());

export const createSharePosterResponse = async ({
  request,
  token,
  fileId,
  shareAccessCookieValue,
}: {
  request: Request;
  token: string;
  fileId?: string;
  shareAccessCookieValue?: string | null;
}) => {
  const { file, downloadDisabled, hasPassword } = fileId
    ? await sharingService.getSharedNestedFileContent({
        token,
        fileId,
        shareAccessCookieValue,
      })
    : await sharingService.getSharedFileContent({
        token,
        shareAccessCookieValue,
      });
  if (hasPassword) throw posterNotFound();

  if (file.viewerKind !== "video") throw posterNotFound();
  await assertStorageEntityReadable("file", file.id);

  const derivative = await findReadyPosterDerivative(file.id);
  if (!derivative) throw posterNotFound();

  return createPublicReadyDerivativeContentResponse({
    request,
    derivative,
    fileName: createPosterFileName(file.name),
    downloadDisabled,
  });
};

/**
 * A ready thumbnail for a file inside a shared folder. Visitors never queue
 * generation; the owner's own views and uploads do that.
 */
export const createShareThumbnailResponse = async ({
  request,
  token,
  fileId,
  shareAccessCookieValue,
}: {
  request: Request;
  token: string;
  fileId: string;
  shareAccessCookieValue?: string | null;
}) => {
  const notFound = () =>
    new MediaContentError(404, "Thumbnail is unavailable.", {
      headers: { "cache-control": "no-store" },
    });
  const resolution = await sharingService.resolvePublicShare({
    token,
    shareAccessCookieValue,
  });
  if (resolution.kind !== "folder" || resolution.share.status !== "active") {
    throw notFound();
  }
  const { file } = await sharingService.getSharedNestedFileContent({
    token,
    fileId,
    shareAccessCookieValue,
  });
  await assertStorageEntityReadable("file", file.id);
  const derivative = await findReadyDerivative(
    file.id,
    DERIVATIVE_KIND_THUMBNAIL,
    DERIVATIVE_PROFILE_THUMB,
  );
  if (!derivative) throw notFound();

  return createPublicReadyDerivativeContentResponse({
    request,
    derivative,
    fileName: `${file.name}.jpg`,
    downloadDisabled: resolution.share.downloadDisabled,
  });
};

export const createPublicShareContentRouteResponse = async ({
  request,
  token,
  fileId,
  shareAccessCookieValue,
}: {
  request: Request;
  token: string;
  fileId?: string;
  shareAccessCookieValue: string | null;
}): Promise<Response> => {
  try {
    const { file, downloadDisabled } = fileId
      ? await sharingService.getSharedNestedFileContent({
          token,
          fileId,
          shareAccessCookieValue,
        })
      : await sharingService.getSharedFileContent({
          token,
          shareAccessCookieValue,
        });
    return await createPublicShareContentResponse({
      request,
      file,
      downloadDisabled,
    });
  } catch (error) {
    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }

    return createShareErrorResponse(error);
  }
};
