import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { getAdminJobSummary } from "@/server/admin/jobs";

export async function GET(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const summary = await getAdminJobSummary();

  return NextResponse.json({
    ...summary,
    workers: summary.workers.map((worker) => ({
      ...worker,
      startedAt: worker.startedAt.toISOString(),
      lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
      stoppedAt: worker.stoppedAt?.toISOString() ?? null,
      createdAt: worker.createdAt.toISOString(),
      updatedAt: worker.updatedAt.toISOString(),
    })),
  });
}
