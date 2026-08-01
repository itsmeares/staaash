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

// Poster routes intentionally share public-share validation and byte responses.
// fallow-ignore-next-line code-duplication
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const cookieStore = await cookies();

  try {
    return await createSharePosterResponse({
      request,
      token,
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
