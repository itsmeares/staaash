// Job action routes intentionally share origin, auth, and response guards.
// fallow-ignore-file code-duplication
import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import { dismissAdminJob } from "@/server/admin/jobs";

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
    const job = await dismissAdminJob(jobId, auth.session.user.id);
    return NextResponse.json({
      message: "Job dismissed.",
      jobId: job.id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to dismiss job.",
      },
      { status: 400 },
    );
  }
}
