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
    const body = await request.json();
    const user = await authService.updateUser(auth.session.user.id, userId, {
      email: body.email,
      displayName: body.displayName,
      storageLimitBytes:
        body.storageLimitBytes === null || body.storageLimitBytes === undefined
          ? null
          : BigInt(body.storageLimitBytes),
      isAdmin: Boolean(body.isAdmin),
    });

    return NextResponse.json({
      user: {
        ...user,
        storageLimitBytes: user.storageLimitBytes?.toString() ?? null,
      },
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
