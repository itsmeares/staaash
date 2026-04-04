import { cookies } from "next/headers";

import { createShareErrorResponse } from "@/app/s/share-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";
import {
  createInlineOriginalContentResponse,
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const cookieStore = await cookies();

  try {
    const { file } = await sharingService.getSharedFileContent({
      token,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });

    return await createInlineOriginalContentResponse({
      request,
      file,
    });
  } catch (error) {
    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }

    return createShareErrorResponse(error);
  }
}
