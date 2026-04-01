import { cookies } from "next/headers";

import { createFileDownloadResponse, createShareErrorResponse } from "@/app/s/share-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{
      token: string;
      fileId: string;
    }>;
  },
) {
  const { token, fileId } = await params;
  const cookieStore = await cookies();

  try {
    const result = await sharingService.getSharedNestedFileDownload({
      token,
      fileId,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });

    return createFileDownloadResponse(result);
  } catch (error) {
    return createShareErrorResponse(error);
  }
}
