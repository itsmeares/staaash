import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
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

const getSignInRedirect = (request: NextRequest, redirectTo: string) =>
  NextResponse.redirect(
    new URL(`/sign-in?next=${encodeURIComponent(redirectTo)}`, request.url),
    303,
  );

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/trash",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/trash");
  const session = await getRequestSession(request);

  if (!session) {
    return wantsJson(request)
      ? NextResponse.json({ error: "Not signed in." }, { status: 401 })
      : getSignInRedirect(request, redirectTo);
  }

  try {
    const { folderId } = await params;
    const result = await libraryService.restoreFolder({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
    });
    const location = result.restoredTo?.pathLabel ?? "Library";

    return wantsJson(request)
      ? NextResponse.json(result)
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          `Restored ${result.folder.name} to ${location}.`,
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
