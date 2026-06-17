import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { jsonErrorResponse } from "@/server/auth/http";
import { authService } from "@/server/auth/service";

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

export async function POST(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await authService.createUser(auth.session.user.id, {
      email: String(body.email ?? ""),
      temporaryPassword: optionalString(body.temporaryPassword),
      confirmTemporaryPassword: optionalString(body.confirmTemporaryPassword),
      generateTemporaryPassword: Boolean(body.generateTemporaryPassword),
      storageLimitBytes:
        body.storageLimitBytes === null || body.storageLimitBytes === undefined
          ? null
          : BigInt(String(body.storageLimitBytes)),
      isAdmin: Boolean(body.isAdmin),
      requirePasswordChange: body.requirePasswordChange !== false,
    });

    return NextResponse.json(
      {
        user: {
          ...result.user,
          storageLimitBytes: result.user.storageLimitBytes?.toString() ?? null,
        },
        temporaryPassword: result.temporaryPassword,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
