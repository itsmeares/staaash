import { NextRequest, NextResponse } from "next/server";

import { canAccessAdminSurface } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonErrorResponse,
  jsonNotSignedInResponse,
} from "@/server/auth/http";
import { authService } from "@/server/auth/service";

type RouteContext = {
  params: Promise<{
    inviteId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
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
    const { inviteId } = await params;
    const result = await authService.reissueInvite(session.user.id, inviteId);
    return NextResponse.json({
      invite: result.invite,
      redeemUrl: new URL(
        `/invite/${result.token}`,
        request.nextUrl.origin,
      ).toString(),
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
