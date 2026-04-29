import { NextRequest, NextResponse } from "next/server";

import { enforceSameOrigin, requireOwnerApiSession } from "@/server/admin/http";
import {
  enqueueAdminStagingCleanup,
  enqueueAdminTrashRetention,
} from "@/server/admin/jobs";
import { enqueueAdminUpdateCheck } from "@/server/admin/updates";
import { enqueueAdminRestoreReconciliation } from "@/server/admin/integrity";
import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";

export async function POST(request: NextRequest) {
  const sameOriginError = enforceSameOrigin(request);
  if (sameOriginError) return sameOriginError;

  const auth = await requireOwnerApiSession(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const kind = typeof body?.kind === "string" ? body.kind : null;

  if (!kind || !ALL_SUPPORTED_JOB_KINDS.includes(kind as never)) {
    return NextResponse.json({ error: "Invalid job kind." }, { status: 400 });
  }

  let result: { created: boolean; job: { id: string } };

  switch (kind) {
    case "staging.cleanup":
      result = await enqueueAdminStagingCleanup();
      break;
    case "trash.retention":
      result = await enqueueAdminTrashRetention();
      break;
    case "update.check":
      result = await enqueueAdminUpdateCheck();
      break;
    case "restore.reconcile":
      result = await enqueueAdminRestoreReconciliation(auth.session.user.id);
      break;
    default:
      return NextResponse.json(
        { error: "Unhandled job kind." },
        { status: 400 },
      );
  }

  return NextResponse.json({
    message: result.created ? "Job queued." : "Job already queued or running.",
    jobId: result.job.id,
  });
}
