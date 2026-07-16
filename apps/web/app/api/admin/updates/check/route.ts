import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import {
  enqueueAdminUpdateCheck,
  getAdminUpdateCheckJob,
  getAdminUpdateStatus,
  toJsonAdminUpdateStatus,
} from "@/server/admin/updates";

export async function GET(request: NextRequest) {
  const auth = await requireOwnerApiSession(request);

  if (!auth.ok) {
    return auth.response;
  }

  const jobId = request.nextUrl.searchParams.get("jobId")?.trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }

  const job = await getAdminUpdateCheckJob(jobId);
  if (!job) {
    return NextResponse.json(
      { error: "Update check job not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      lastError: job.lastError,
    },
    updateStatus: toJsonAdminUpdateStatus(await getAdminUpdateStatus()),
  });
}

// fallow-ignore-next-line code-duplication
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
