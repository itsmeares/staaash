import { NextRequest, NextResponse } from "next/server";

import { requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminStorageSummary,
  toJsonAdminStorageSummary,
} from "@/server/admin/storage";

export async function GET(request: NextRequest) {
  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(
    toJsonAdminStorageSummary(await getAdminStorageSummary()),
  );
}
