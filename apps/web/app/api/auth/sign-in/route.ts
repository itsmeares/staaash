import { NextRequest, NextResponse } from "next/server";

import { buildSessionCookie } from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import {
  formErrorResponse,
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
      : formErrorResponse(
          request,
          "/sign-in",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const next = getSafeRedirectTarget(body.next, "/library");

  try {
    const result = await authService.signIn({
      identifier: body.identifier,
      password: body.password,
    });
    const response = wantsJson(request)
      ? NextResponse.json({ user: result.user, session: result.session })
      : NextResponse.redirect(new URL(next, request.url), 303);

    response.cookies.set(
      buildSessionCookie(result.sessionToken, result.session.expiresAt),
    );

    return response;
  } catch (error) {
    const errorPath =
      next === "/library"
        ? "/sign-in"
        : `/sign-in?next=${encodeURIComponent(next)}`;
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, errorPath, error);
  }
}
