import { findReadyPosterDerivative } from "@staaash/db/media-derivatives";

import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import { createPublicReadyDerivativeContentResponse } from "@/server/media/public-share-content-response";
import type { FileSummary } from "@/server/files/types";
import { sharingService } from "@/server/sharing/service";

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

  const derivative = await findReadyPosterDerivative(file.id);
  if (!derivative) throw posterNotFound();

  return createPublicReadyDerivativeContentResponse({
    request,
    derivative,
    fileName: createPosterFileName(file.name),
    downloadDisabled: resolution.share.downloadDisabled,
  });
};
