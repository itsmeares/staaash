import { NextRequest, NextResponse } from "next/server";

import { requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminUpdateStatus,
  toJsonAdminUpdateStatus,
} from "@/server/admin/updates";

export async function GET(request: NextRequest) {
  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(
    toJsonAdminUpdateStatus(await getAdminUpdateStatus()),
  );
}
