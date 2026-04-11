import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse } from "@/server/auth/http";
import { authService } from "@/server/auth/service";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const sameOriginError = enforceSameOrigin(request);

  if (sameOriginError) {
    return sameOriginError;
  }

  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const { userId } = await params;
    const result = await authService.issuePasswordReset(
      auth.session.user.id,
      userId,
    );
    return NextResponse.json({
      reset: result.reset,
      user: result.user,
      resetUrl: new URL(
        `/reset/${result.token}`,
        request.nextUrl.origin,
      ).toString(),
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
