import { NextRequest, NextResponse } from "next/server";

import {
  buildOnboardedCookie,
  buildThemeCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { getBaseUrl } from "@/server/request";

export async function GET(request: NextRequest) {
  const session = await authService.getSession(
    getSessionTokenFromCookieStore(request.cookies),
  );

  if (!session?.user.preferences?.onboardingCompletedAt) {
    return NextResponse.redirect(new URL("/", getBaseUrl(request.headers)));
  }

  const response = NextResponse.redirect(
    new URL("/files", getBaseUrl(request.headers)),
  );
  response.cookies.set(buildOnboardedCookie(request));
  response.cookies.set(
    buildThemeCookie(session.user.preferences.theme, request),
  );
  return response;
}
