import {
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_THUMB,
  findReadyDerivative,
  findReadyPosterDerivative,
} from "@staaash/db/media-derivatives";

import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import { createPublicReadyDerivativeContentResponse } from "@/server/media/public-share-content-response";
import { sharingService } from "@/server/sharing/service";
import { assertStorageEntityReadable } from "@/server/storage-read-guard";

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
