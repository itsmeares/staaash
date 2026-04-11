import { NextRequest, NextResponse } from "next/server";

import { requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminHealthSummary,
  toJsonInstanceHealthSummary,
} from "@/server/health";

export async function GET(request: NextRequest) {
  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(
    toJsonInstanceHealthSummary(await getAdminHealthSummary()),
  );
}
