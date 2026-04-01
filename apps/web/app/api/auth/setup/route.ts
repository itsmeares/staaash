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
          "/setup",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  try {
    const body = await readRequestBody(request);
    const result = await authService.bootstrap({
      instanceName: body.instanceName,
      email: body.email,
      username: body.username,
      displayName: body.displayName,
      password: body.password,
    });
    const response = wantsJson(request)
      ? NextResponse.json(
          { user: result.user, session: result.session },
          { status: 201 },
        )
      : NextResponse.redirect(new URL("/library", request.url), 303);

    response.cookies.set(
      buildSessionCookie(result.sessionToken, result.session.expiresAt),
    );

    return response;
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, "/setup", error);
  }
}
