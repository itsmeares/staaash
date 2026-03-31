import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
  readRequestBody,
  redirectWithMessage,
  wantsJson,
} from "@/server/auth/http";
import { libraryService } from "@/server/library/service";

type RouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/library",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/library");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const { folderId } = await params;
    const result = await libraryService.moveFolder({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
      destinationFolderId: body.destinationFolderId || null,
    });

    return wantsJson(request)
      ? NextResponse.json(result)
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          `Moved folder ${result.folder.name}.`,
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
