import { NextResponse } from "next/server";

import { canAccessAdminSurface } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { jsonNotSignedInResponse } from "@/server/auth/http";
import {
  getAdminHealthSummary,
  toJsonInstanceHealthSummary,
} from "@/server/health";

export async function GET(
  request: Request & {
    cookies: { get(name: string): { value: string } | undefined };
  },
) {
  const session = await getRequestSession(request);

  if (!session) {
    return jsonNotSignedInResponse();
  }

  if (!canAccessAdminSurface(session.user.role)) {
    return NextResponse.json(
      { error: "Owner access required." },
      { status: 403 },
    );
  }

  return NextResponse.json(
    toJsonInstanceHealthSummary(await getAdminHealthSummary()),
  );
}
