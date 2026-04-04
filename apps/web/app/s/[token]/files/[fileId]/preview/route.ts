import { cookies } from "next/headers";

import {
  createPreviewResponse,
  createSharePreviewErrorResponse,
} from "@/app/s/preview-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; fileId: string }> },
) {
  const { token, fileId } = await params;
  const cookieStore = await cookies();

  try {
    const { file } = await sharingService.getSharedNestedFilePreview({
      token,
      fileId,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });

    return createPreviewResponse(file);
  } catch (error) {
    return createSharePreviewErrorResponse(error);
  }
}
