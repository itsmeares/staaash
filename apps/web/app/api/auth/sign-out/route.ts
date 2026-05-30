import { NextRequest, NextResponse } from "next/server";

import {
  buildClearedOnboardedCookie,
  buildClearedSessionCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { getBaseUrl } from "@/server/request";
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
      : NextResponse.redirect(new URL("/", getBaseUrl(request.headers)), 303);
  }

  const body = await readRequestBody(request);
  const next = getSafeRedirectTarget(body.next, "/");

  try {
    await authService.revokeSession(
      getSessionTokenFromCookieStore(request.cookies),
    );
    const response = wantsJson(request)
      ? NextResponse.json({ ok: true })
      : NextResponse.redirect(new URL(next, getBaseUrl(request.headers)), 303);

    response.cookies.set(buildClearedSessionCookie(request));
    response.cookies.set(buildClearedOnboardedCookie(request));

    return response;
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : NextResponse.redirect(
          new URL(
            "/settings?error=Unable%20to%20sign%20out.",
            getBaseUrl(request.headers),
          ),
          303,
        );
  }
}
