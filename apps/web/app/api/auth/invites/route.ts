import { NextRequest, NextResponse } from "next/server";

import { canAccessAdminSurface } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonNotSignedInResponse,
  jsonErrorResponse,
  readRequestBody,
} from "@/server/auth/http";
import { authService } from "@/server/auth/service";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);

  if (!session) {
    return jsonNotSignedInResponse();
  }

  if (!canAccessAdminSurface(session.user.role)) {
    return NextResponse.json(
      { error: "Owner access required." },
      { status: 403 },
    );
  }

  try {
    const body = await readRequestBody(request);
    const result = await authService.createInvite(session.user.id, {
      email: body.email,
    });
    return NextResponse.json(
      {
        invite: result.invite,
        redeemUrl: new URL(
          `/invite/${result.token}`,
          request.nextUrl.origin,
        ).toString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
