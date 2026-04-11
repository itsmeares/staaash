import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse, readRequestBody } from "@/server/auth/http";
import { authService } from "@/server/auth/service";

export async function POST(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);

  if (sameOriginError) {
    return sameOriginError;
  }

  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = await readRequestBody(request);
    const result = await authService.issuePasswordReset(
      auth.session.user.id,
      body.userId,
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
