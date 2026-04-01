import { cookies } from "next/headers";

import { createFileDownloadResponse, createShareErrorResponse } from "@/app/s/share-response";
import { SHARE_ACCESS_COOKIE_NAME, sharingService } from "@/server/sharing";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const cookieStore = await cookies();

  try {
    const result = await sharingService.getSharedFileDownload({
      token,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });

    return createFileDownloadResponse(result);
  } catch (error) {
    return createShareErrorResponse(error);
  }
}
