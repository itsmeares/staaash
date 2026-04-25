import { NextRequest, NextResponse } from "next/server";

// Hardcoded — cannot import from server/auth/session (pulls node:crypto via service.ts)
const SESSION_COOKIE = "staaash_session";
const ONBOARDED_COOKIE = "staaash_onboarded";

const WORKSPACE_PREFIX = ["/files", "/settings", "/admin", "/invite", "/share"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const isWorkspace = WORKSPACE_PREFIX.some((p) => pathname.startsWith(p));
  if (!isWorkspace) return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  const hasOnboarded = request.cookies.get(ONBOARDED_COOKIE)?.value === "1";

  if (hasSession && !hasOnboarded) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
