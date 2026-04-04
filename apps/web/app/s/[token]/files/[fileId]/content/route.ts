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
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  const cookieStore = await cookies();

  try {
    const { file } = await sharingService.getSharedNestedFileContent({
      token,
      fileId,
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
