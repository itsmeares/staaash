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
          "/files",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/files");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const { fileId } = await params;
    const quickAccessPinned =
      body.quickAccessPinned === undefined
        ? undefined
        : parseBoolean(body.quickAccessPinned, false);
    const result =
      quickAccessPinned === undefined
        ? await retrievalService.setFileFavorite({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            fileId,
            isFavorite: parseBoolean(body.isFavorite, true),
          })
        : await retrievalService.setFileFavoriteQuickAccess({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            fileId,
            quickAccessPinned,
          });

    return wantsJson(request)
      ? NextResponse.json(result)
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          quickAccessPinned === undefined
            ? result.isFavorite
              ? "Added file to favorites."
              : "Removed file from favorites."
            : quickAccessPinned
              ? "Pinned file to quick access."
              : "Removed file from quick access.",
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
