import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { retryAdminJob } from "@/server/admin/jobs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const { jobId } = await params;

  try {
    const job = await retryAdminJob(jobId, auth.session.user.id);
    return NextResponse.json({
      message: "Job queued for retry.",
      jobId: job.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to retry job.",
      },
      { status: 400 },
    );
  }
}
