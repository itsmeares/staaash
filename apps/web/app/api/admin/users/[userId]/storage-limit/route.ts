import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse } from "@/server/auth/http";
import { authService } from "@/server/auth/service";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  try {
    const { userId } = await params;
    const body = (await request.json()) as { limitBytes: string | null };

    const limitBytes =
      body.limitBytes !== null && body.limitBytes !== undefined
        ? BigInt(body.limitBytes)
        : null;

    const user = await authService.setStorageLimit(
      auth.session.user.id,
      userId,
      limitBytes,
    );

    return NextResponse.json({
      id: user.id,
      storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
