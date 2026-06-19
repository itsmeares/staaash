import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { getAdminJobSummary, toJsonAdminJobSummary } from "@/server/admin/jobs";

export async function GET(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const summary = await getAdminJobSummary();

  return NextResponse.json(toJsonAdminJobSummary(summary));
}
