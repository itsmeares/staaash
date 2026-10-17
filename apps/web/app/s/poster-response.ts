import { findReadyPosterDerivative } from "@staaash/db/media-derivatives";

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
