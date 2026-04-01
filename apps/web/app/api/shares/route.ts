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
import { createShareSchema } from "@/server/sharing/schema";
import { sharingService } from "@/server/sharing/service";

export async function POST(request: NextRequest) {
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

  const body = createShareSchema.parse(await readRequestBody(request));
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/shared");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const result =
      body.mode === "reissue"
        ? await sharingService.reissueShare({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            shareId: body.shareId!,
          })
        : await sharingService.createOrReissueShare({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            targetType: body.targetType!,
            fileId: body.fileId,
            folderId: body.folderId,
            expiresAt: body.expiresAt,
            downloadDisabled: body.downloadDisabled,
            password: body.password,
          });

    return wantsJson(request)
      ? NextResponse.json(
          {
            share: result.share,
            shareUrl: result.shareUrl,
          },
          { status: body.mode === "reissue" ? 200 : 201 },
        )
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          "Public link ready.",
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
