import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { enqueueAdminUpdateCheck } from "@/server/admin/updates";

export async function POST(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);

  if (sameOriginError) {
    return sameOriginError;
  }

  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  const result = await enqueueAdminUpdateCheck();

  return NextResponse.json({
    message: result.created
      ? "Update check queued."
      : "An active update check is already queued or running.",
    jobId: result.job.id,
  });
}
