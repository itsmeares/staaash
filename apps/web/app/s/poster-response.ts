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
import type { FileSummary } from "@/server/files/types";
import { sharingService } from "@/server/sharing/service";
import { assertStorageEntityReadable } from "@/server/storage-read-guard";

const posterNotFound = () =>
  new MediaContentError(404, "Poster content is unavailable.");

const assertPublicPosterShare = (share: {
  hasPassword: boolean;
  status: string;
}) => {
  if (share.hasPassword || share.status !== "active") {
    throw posterNotFound();
  }
};

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
  const resolution = await sharingService.resolvePublicShare({
    token,
    shareAccessCookieValue,
  });
  assertPublicPosterShare(resolution.share);

  let file: Pick<FileSummary, "id" | "name" | "viewerKind">;

  if (fileId) {
    if (resolution.kind !== "folder") throw posterNotFound();
    file = (
      await sharingService.getSharedNestedFileContent({
        token,
        fileId,
        shareAccessCookieValue,
      })
    ).file;
  } else {
    if (resolution.kind !== "file") throw posterNotFound();
    file = resolution.file;
  }

  if (file.viewerKind !== "video") throw posterNotFound();
  await assertStorageEntityReadable("file", file.id);

  const derivative = await findReadyPosterDerivative(file.id);
  if (!derivative) throw posterNotFound();

  return createPublicReadyDerivativeContentResponse({
    request,
    derivative,
    fileName: createPosterFileName(file.name),
    downloadDisabled: resolution.share.downloadDisabled,
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
