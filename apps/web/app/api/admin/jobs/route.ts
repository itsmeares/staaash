import { NextRequest, NextResponse } from "next/server";

import { requireOwnerApiSession } from "@/server/admin/http";
import {
  getAdminJobList,
  parseAdminJobFilters,
  toJsonAdminJobListResponse,
} from "@/server/admin/jobs";

export async function GET(request: NextRequest) {
  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  const filters = parseAdminJobFilters({
    status: request.nextUrl.searchParams.get("status"),
    kind: request.nextUrl.searchParams.get("kind"),
    cursor: request.nextUrl.searchParams.get("cursor"),
  });

  return NextResponse.json(
    toJsonAdminJobListResponse(
      await getAdminJobList({
        ...filters,
        limit: 25,
      }),
    ),
  );
}
