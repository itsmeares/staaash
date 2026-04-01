import { cookies } from "next/headers";

import {
  createArchiveResponse,
  createShareErrorResponse,
} from "@/app/s/share-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const cookieStore = await cookies();

  try {
    const result = await sharingService.createFolderArchive({
      token,
      shareAccessCookieValue:
        cookieStore.get(SHARE_ACCESS_COOKIE_NAME)?.value ?? null,
    });

    return createArchiveResponse(result);
  } catch (error) {
    return createShareErrorResponse(error);
  }
}
