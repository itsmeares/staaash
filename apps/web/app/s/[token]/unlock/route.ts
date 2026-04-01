import { NextRequest, NextResponse } from "next/server";

import { getSafeLocalPath } from "@/app/auth-ui";
import {
  formErrorResponse,
  isSameOrigin,
  jsonErrorResponse,
  readRequestBody,
  wantsJson,
} from "@/server/auth/http";
import { buildShareAccessCookie } from "@/server/sharing/access-cookie";
import { sharingService } from "@/server/sharing/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const fallbackPath = `/s/${encodeURIComponent(token)}`;

  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          fallbackPath,
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeLocalPath(body.redirectTo, fallbackPath);

  try {
    const result = await sharingService.unlockShare({
      token,
      password: body.password,
    });
    const response = wantsJson(request)
      ? NextResponse.json({ ok: true })
      : NextResponse.redirect(new URL(redirectTo, request.url), 303);

    response.cookies.set(
      buildShareAccessCookie({
        shareId: result.share.id,
        tokenLookupKey: result.share.tokenLookupKey,
        passwordHash: result.share.passwordHash!,
        token,
      }),
    );

    return response;
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
