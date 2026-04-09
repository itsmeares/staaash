import { NextRequest, NextResponse } from "next/server";

import { canAccessAdminSurface } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, jsonNotSignedInResponse } from "@/server/auth/http";

export const requireOwnerApiSession = async (request: NextRequest) => {
  const session = await getRequestSession(request);

  if (!session) {
    return {
      ok: false as const,
      response: jsonNotSignedInResponse(),
    };
  }

  if (!canAccessAdminSurface(session.user.role)) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { error: "Owner access required." },
        { status: 403 },
      ),
    };
  }

  return {
    ok: true as const,
    session,
  };
};

export const enforceSameOrigin = (request: NextRequest) =>
  isSameOrigin(request)
    ? null
    : NextResponse.json(
        { error: "Cross-origin requests are not allowed." },
        { status: 403 },
      );
