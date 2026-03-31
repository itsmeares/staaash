import { NextRequest, NextResponse } from "next/server";

import {
  buildClearedSessionCookie,
  getSessionTokenFromCookieStore,
} from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import { isSameOrigin, jsonNotSignedInResponse } from "@/server/auth/http";

export async function GET(request: NextRequest) {
  const session = await authService.getSession(
    getSessionTokenFromCookieStore(request.cookies),
  );

  if (!session) {
    return jsonNotSignedInResponse();
  }

  return NextResponse.json(session);
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  await authService.revokeSession(
    getSessionTokenFromCookieStore(request.cookies),
  );
  const response = NextResponse.json({ ok: true });
  response.cookies.set(buildClearedSessionCookie());
  return response;
}
