import { cookies } from "next/headers";

import { createShareErrorResponse } from "@/app/s/share-response";
import { SHARE_ACCESS_COOKIE_NAME } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";

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

    if (!file.viewerKind) {
      return new Response("Preview not supported for this file type.", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    return Response.redirect(
      new URL(`/s/${encodeURIComponent(token)}/content`, request.url),
      307,
    );
  } catch (error) {
    return createShareErrorResponse(error);
  }
}
