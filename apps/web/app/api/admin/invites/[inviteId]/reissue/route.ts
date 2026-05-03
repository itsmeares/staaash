import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse } from "@/server/auth/http";
import { authService } from "@/server/auth/service";
import { getBaseUrl } from "@/server/request";

type RouteContext = {
  params: Promise<{
    inviteId: string;
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
    const { inviteId } = await params;
    const result = await authService.reissueInvite(
      auth.session.user.id,
      inviteId,
    );
    return NextResponse.json({
      invite: result.invite,
      redeemUrl: new URL(
        `/invite/${result.token}`,
        getBaseUrl(request.headers),
      ).toString(),
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
