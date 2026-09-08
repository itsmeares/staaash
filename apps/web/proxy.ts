import { NextRequest, NextResponse } from "next/server";

import {
  DIRECT_UPLOAD_REQUEST_TOO_LARGE_MESSAGE,
  isDirectUploadRequestTooLarge,
} from "@/lib/upload-limits";

// Hardcoded — cannot import from server/auth/session (pulls node:crypto via service.ts)
const SESSION_COOKIE = "staaash_session";
const ONBOARDED_COOKIE = "staaash_onboarded";

const WORKSPACE_PREFIX = [
  "/admin",
  "/favorites",
  "/files",
  "/home",
  "/recent",
  "/search",
  "/settings",
  "/shared",
  "/trash",
];

const oversizedDirectUploadResponse = (request: NextRequest) => {
  if (request.method !== "POST") return null;
  if (request.nextUrl.pathname !== "/api/files/files") return null;
  if (!isDirectUploadRequestTooLarge(request.headers.get("content-length"))) {
    return null;
  }

  return NextResponse.json(
    {
      error: DIRECT_UPLOAD_REQUEST_TOO_LARGE_MESSAGE,
      code: "UPLOAD_REQUEST_TOO_LARGE",
    },
    { status: 413 },
  );
};

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const oversizedUploadResponse = oversizedDirectUploadResponse(request);
  if (oversizedUploadResponse) return oversizedUploadResponse;

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
  matcher: [
    "/api/files/files",
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
