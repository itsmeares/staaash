import { NextRequest, NextResponse } from "next/server";

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
import { getRequestSession } from "@/server/auth/guards";
import { updateShareSchema } from "@/server/sharing/schema";
import { sharingService } from "@/server/sharing/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  const { shareId } = await params;

  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/shared",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = updateShareSchema.parse(await readRequestBody(request));
  const redirectTo = getSafeRedirectTarget(body.redirectTo, `/shared#${shareId}`);
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const share = await sharingService.updateShare({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      shareId,
      expiresAt: body.expiresAt,
      downloadDisabled: body.downloadDisabled,
    });

    return wantsJson(request)
      ? NextResponse.json({ share })
      : redirectWithMessage(request, redirectTo, "success", "Share policy updated.");
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
