import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import {
  enqueueAdminRestoreReconciliation,
  getAdminIntegritySummary,
  toJsonAdminIntegritySummary,
} from "@/server/admin/integrity";

export async function GET(request: NextRequest) {
  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  return NextResponse.json(
    toJsonAdminIntegritySummary(await getAdminIntegritySummary()),
  );
}

export async function POST(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);

  if (sameOriginError) {
    return sameOriginError;
  }

  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  const result = await enqueueAdminRestoreReconciliation(auth.session.user.id);

  return NextResponse.json({
    message: result.created
      ? "Restore reconciliation queued."
      : "An active restore reconciliation is already queued or running.",
    jobId: result.job.id,
    runId: result.run?.id ?? null,
  });
}
