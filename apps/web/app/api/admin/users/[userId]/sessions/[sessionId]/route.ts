import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse } from "@/server/auth/http";
import { authService } from "@/server/auth/service";

type RouteContext = {
  params: Promise<{
    userId: string;
    sessionId: string;
  }>;
};

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  const sameOriginError = enforceSameOrigin(_request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(_request);
  if (!auth.ok) return auth.response;

  try {
    const { userId, sessionId } = await params;
    await authService.revokeUserSession(
      auth.session.user.id,
      userId,
      sessionId,
      auth.session.id,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
