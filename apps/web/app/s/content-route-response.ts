import { cookies } from "next/headers";

import { createShareErrorResponse } from "@/app/s/share-response";
import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import { createPublicShareContentResponse } from "@/server/media/public-share-content-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";

export const createPublicShareContentRouteResponse = async ({
  request,
  token,
  fileId,
}: {
  request: Request;
  token: string;
  fileId?: string;
}): Promise<Response> => {
  const cookieStore = await cookies();
  const shareAccessCookieValue =
    cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null;

  try {
    const { file } = fileId
      ? await sharingService.getSharedNestedFileContent({
          token,
          fileId,
          shareAccessCookieValue,
        })
      : await sharingService.getSharedFileContent({
          token,
          shareAccessCookieValue,
        });

    return await createPublicShareContentResponse({ request, file });
  } catch (error) {
    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }

    return createShareErrorResponse(error);
  }
};
