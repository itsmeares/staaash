import { NextRequest, NextResponse } from "next/server";

import {
  buildClearedOnboardedCookie,
  buildOnboardedCookie,
  buildThemeCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import {
  isSameOrigin,
  jsonErrorResponse,
  jsonNotSignedInResponse,
  readRequestBody,
} from "@/server/auth/http";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await authService.getSession(
    getSessionTokenFromCookieStore(request.cookies),
  );

  if (!session) {
    return jsonNotSignedInResponse();
  }

  try {
    const body = await readRequestBody(request);
    const user = await authService.changeRequiredPassword(session.user.id, {
      password: body.password,
      confirmPassword: body.confirmPassword,
    });
    const onboardingCompleted = Boolean(
      user.preferences?.onboardingCompletedAt,
    );
    const response = NextResponse.json({ onboardingCompleted });

    if (onboardingCompleted && user.preferences) {
      response.cookies.set(buildOnboardedCookie(request));
      response.cookies.set(buildThemeCookie(user.preferences.theme, request));
    } else {
      response.cookies.set(buildClearedOnboardedCookie(request));
    }

    return response;
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
