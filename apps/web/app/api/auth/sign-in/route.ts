import { NextRequest, NextResponse } from "next/server";

import {
  buildOnboardedCookie,
  buildSessionCookie,
  buildThemeCookie,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
  readRequestBody,
  wantsJson,
} from "@/server/auth/http";
import { getBaseUrl } from "@/server/request";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const next = getSafeRedirectTarget(body.next, "/files");

  try {
    const result = await authService.signIn({
      identifier: body.identifier,
      password: body.password,
    });
    const response = wantsJson(request)
      ? NextResponse.json({ user: result.user, session: result.session })
      : NextResponse.redirect(new URL(next, getBaseUrl(request.headers)), 303);

    response.cookies.set(
      buildSessionCookie(result.sessionToken, result.session.expiresAt),
    );

    const prefs = result.session.user.preferences;
    if (prefs?.onboardingCompletedAt) {
      response.cookies.set(buildOnboardedCookie());
      response.cookies.set(buildThemeCookie(prefs.theme));
    }

    return response;
  } catch (error) {
    const errorPath =
      next === "/files" ? "/" : `/?next=${encodeURIComponent(next)}`;
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, errorPath, error);
  }
}
