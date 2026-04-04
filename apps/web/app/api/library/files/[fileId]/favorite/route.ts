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
import { retrievalService } from "@/server/retrieval/service";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

const parseBoolean = (value: string | undefined, fallback: boolean) =>
  value === undefined ? fallback : value === "true";

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
    const { fileId } = await params;
    const result = await retrievalService.setFileFavorite({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      fileId,
      isFavorite: parseBoolean(body.isFavorite, true),
    });

    return wantsJson(request)
      ? NextResponse.json(result)
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          result.isFavorite
            ? "Added file to favorites."
            : "Removed file from favorites.",
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
