import { NextRequest, NextResponse } from "next/server";

import {
  buildClearedOnboardedCookie,
  buildClearedSessionCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import {
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
  readRequestBody,
  wantsJson,
} from "@/server/auth/http";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : NextResponse.redirect(new URL("/", request.url), 303);
  }

  const body = await readRequestBody(request);
  const next = getSafeRedirectTarget(body.next, "/");

  try {
    await authService.revokeSession(
      getSessionTokenFromCookieStore(request.cookies),
    );
    const response = wantsJson(request)
      ? NextResponse.json({ ok: true })
      : NextResponse.redirect(new URL(next, request.url), 303);

    response.cookies.set(buildClearedSessionCookie());
    response.cookies.set(buildClearedOnboardedCookie());

    return response;
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : NextResponse.redirect(
          new URL("/settings?error=Unable%20to%20sign%20out.", request.url),
          303,
        );
  }
}
