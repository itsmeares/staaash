import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse } from "@/server/auth/http";
import { authService } from "@/server/auth/service";

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

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
    const body: Record<string, unknown> = request.headers
      .get("content-type")
      ?.includes("application/json")
      ? ((await request.json()) as Record<string, unknown>)
      : {};
    const result = await authService.resetTemporaryPassword(
      auth.session.user.id,
      userId,
      {
        temporaryPassword: optionalString(body.temporaryPassword),
        confirmTemporaryPassword: optionalString(body.confirmTemporaryPassword),
        generateTemporaryPassword: body.generateTemporaryPassword !== false,
        requirePasswordChange: body.requirePasswordChange !== false,
      },
    );
    return NextResponse.json({
      user: {
        ...result.user,
        storageLimitBytes: result.user.storageLimitBytes?.toString() ?? null,
      },
      temporaryPassword: result.temporaryPassword,
      signInUrl: new URL("/", request.nextUrl.origin).toString(),
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
