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
    const result = await authService.createInvite(auth.session.user.id, {
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
