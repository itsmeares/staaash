import { NextRequest, NextResponse } from "next/server";

import { buildSessionCookie } from "@/server/auth/session";
import { authService } from "@/server/auth/service";
import {
  formErrorResponse,
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
  const token = body.token;
  const fallbackPath = token
    ? `/invite/${encodeURIComponent(token)}`
    : "/sign-in";

  try {
    const result = await authService.redeemInvite({
      token: body.token,
      username: body.username,
      displayName: body.displayName,
      password: body.password,
    });
    const response = wantsJson(request)
      ? NextResponse.json(
          { user: result.user, session: result.session },
          { status: 201 },
        )
      : NextResponse.redirect(new URL("/files", request.url), 303);

    response.cookies.set(
      buildSessionCookie(result.sessionToken, result.session.expiresAt),
    );

    return response;
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, fallbackPath, error);
  }
}
