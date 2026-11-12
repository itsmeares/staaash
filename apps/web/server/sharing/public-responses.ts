import { contentDisposition } from "@/server/downloads/content-disposition";
import type { Readable } from "node:stream";

import {
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_THUMB,
  canHaveThumbnail,
  findReadyDerivative,
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
import { queueCardPicture } from "@/server/sharing/chat-media";
import { createRangeResponseFromPath } from "@/server/downloads/range-response";
import { prismaFilesRepository } from "@/server/files/repository";
import { ShareError, isShareError } from "@/server/sharing/errors";
import type { ShareDownloadResult } from "@/server/sharing/types";
import {
  assertStorageEntityReadable,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

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
      "content-disposition": contentDisposition("attachment", fileName),
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
        "cache-control": "no-store",
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
      // A share can come back (restore, new password), so a browser must
      // not keep the refusal.
      "cache-control": "no-store",
    },
  });
};

/**
 * A ready thumbnail of a shared file, also used as its link card picture. A
 * missing one is queued, so a later request finds it.
 */
export const createShareThumbnailResponse = async ({
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
  await assertStorageEntityReadable("file", file.id);
  const derivative = await findReadyDerivative(
    file.id,
    DERIVATIVE_KIND_THUMBNAIL,
    DERIVATIVE_PROFILE_THUMB,
  );
  if (!derivative) {
    // Cards already posted in chats ask for the picture directly.
    if (canHaveThumbnail(file.mimeType, file.name))
      await queueCardPicture(file.id).catch(() => {});
    throw new MediaContentError(404, "Thumbnail is unavailable.");
  }
  return createPublicReadyDerivativeContentResponse({
    request,
    derivative,
    fileName: `${file.name}.jpg`,
    downloadDisabled,
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
