import { getPrisma, Prisma } from "@staaash/db/client";
import { MEDIA_DERIVATIVE_GENERATE_JOB_KIND } from "@staaash/db/jobs";
import {
  buildDerivativeDedupeKey,
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_PROFILE_1080P,
} from "@staaash/db/media-derivatives";

/** The caller must authorize access to the private file before reading its job state. */
export async function getPrivatePreviewStatus(fileId: string) {
  const db = getPrisma();
  // Read one snapshot: a job can finish between the two status queries.
  const [job, derivative] = await db.$transaction(
    [
      db.backgroundJob.findFirst({
        where: {
          kind: MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
          dedupeKey: buildDerivativeDedupeKey(
            fileId,
            DERIVATIVE_KIND_PREVIEW,
            DERIVATIVE_PROFILE_1080P,
          ),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, status: true },
      }),
      db.mediaDerivative.findUnique({
        where: {
          fileId_kind_profile: {
            fileId,
            kind: DERIVATIVE_KIND_PREVIEW,
            profile: DERIVATIVE_PROFILE_1080P,
          },
        },
        select: { status: true, generatedAt: true, generationJobId: true },
      }),
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  const preview = derivative ?? {
    status: "none",
    generatedAt: null,
    generationJobId: null,
  };
  const status = resolveStatus(job, preview);
  return {
    status,
    generatedAt:
      status === "ready" ? (preview.generatedAt?.toISOString() ?? null) : null,
  };
}

type PreviewRecord = { status: string; generationJobId: string | null };
const isUnfinished = (preview: PreviewRecord) =>
  ["queued", "processing"].includes(preview.status);
function runningStatus(jobId: string, preview: PreviewRecord) {
  if (preview.generationJobId !== jobId) return "processing";
  // Publication can finish before the worker completes the job bookkeeping.
  return preview.status === "ready" ? "ready" : "processing";
}
function resolveStatus(
  job: { id: string; status: string } | null,
  preview: PreviewRecord,
) {
  if (!job) return preview.status;
  if (job.status === "running") return runningStatus(job.id, preview);
  if (job.status === "cancelled" || job.status === "succeeded") {
    return isUnfinished(preview) ? "stale" : preview.status;
  }
  const states: Record<string, string> = {
    queued: "queued",
    failed: "failed",
    dead: "failed",
  };
  return states[job.status] ?? preview.status;
}
