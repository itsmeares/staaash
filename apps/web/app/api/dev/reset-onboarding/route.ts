import { NextRequest, NextResponse } from "next/server";

import { getPrisma } from "@staaash/db/client";
import {
  buildClearedOnboardedCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const session = await authService.getSession(
    getSessionTokenFromCookieStore(request.cookies),
  );

  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  await getPrisma().userPreference.update({
    where: { userId: session.user.id },
    data: { onboardingCompletedAt: null },
  });

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.set(buildClearedOnboardedCookie());
  return response;
}
