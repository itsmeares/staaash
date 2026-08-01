// Public poster routes intentionally share fail-closed share validation.
// fallow-ignore-file code-duplication
import { cookies } from "next/headers";

import {
  createPosterErrorResponse,
  createSharePosterResponse,
} from "@/app/s/poster-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import {
  createStorageEntityUnavailableResponse,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  const cookieStore = await cookies();

  try {
    return await createSharePosterResponse({
      request,
      token,
      fileId,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });
  } catch (error) {
    if (error instanceof StorageEntityUnavailableError) {
      return createStorageEntityUnavailableResponse(error);
    }
    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }

    return createPosterErrorResponse();
  }
}
