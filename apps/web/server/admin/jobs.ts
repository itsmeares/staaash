import {
  listAdminBackgroundJobItems,
  listAdminBackgroundJobs,
  type AdminBackgroundJobListFilters,
  type AdminBackgroundJobListResult,
} from "@staaash/db/admin";
import { getPrisma } from "@staaash/db/client";
import {
  ALL_SUPPORTED_JOB_KINDS,
  MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
  STAGING_CLEANUP_JOB_KIND,
  TRASH_RETENTION_JOB_KIND,
  ZIP_ARCHIVE_GENERATE_JOB_KIND,
  cancelBackgroundJob,
  ensureBackgroundJobScheduled,
  getQueueOperationalSummary,
  listBackgroundJobEvents,
  dismissBackgroundJob,
  retryBackgroundJob,
  type BackgroundJobRecord,
  type QueueOperationalSummary,
} from "@staaash/db/jobs";

import type { JsonAdminJobListResponse } from "./types";

// A zip belongs to one download, and the person downloading sees how it went.
export const ADMIN_JOB_KINDS = ALL_SUPPORTED_JOB_KINDS.filter(
  (kind) => kind !== ZIP_ARCHIVE_GENERATE_JOB_KIND,
);

const ADMIN_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
] as const;

type AdminJobStatusFilter = (typeof ADMIN_JOB_STATUSES)[number];

export const parseAdminJobFilters = (params: {
  status?: string | null;
  kind?: string | null;
  cursor?: string | null;
  limit?: string | null;
  page?: string | null;
}) => {
  const statuses = parseAdminJobStatusFilter(params.status);
  const kind = params.kind?.trim() ?? "";

  return {
    status: statuses,
    kind: ALL_SUPPORTED_JOB_KINDS.includes(
      kind as (typeof ALL_SUPPORTED_JOB_KINDS)[number],
    )
      ? kind
      : null,
    cursor: params.cursor?.trim() || null,
    limit: normalizeAdminJobLimit(params.limit),
    page: normalizeAdminJobPage(params.page),
  } satisfies Pick<
    AdminBackgroundJobListFilters,
    "status" | "kind" | "cursor" | "limit" | "page"
  >;
};

const parseAdminJobStatusFilter = (status?: string | null) => {
  const values = [
    ...new Set(
      (status ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is AdminJobStatusFilter =>
          ADMIN_JOB_STATUSES.includes(value as AdminJobStatusFilter),
        ),
    ),
  ];

  if (values.length === 0) return null;
  if (values.length === 1) return values[0]!;
  return values;
};

const normalizeAdminJobLimit = (limit?: string | null) => {
  const parsed = Number.parseInt(limit ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
};

const normalizeAdminJobPage = (page?: string | null) => {
  const parsed = Number.parseInt(page ?? "", 10);
  return Number.isFinite(parsed) ? Math.max(parsed, 1) : 1;
};

export const getAdminJobSummary = async () => getQueueOperationalSummary();

export const getAdminJobStateSnapshot = async () => {
  const [lastRuns, summary, problems] = await Promise.all([
    getLastRunPerKind(),
    getAdminJobSummary(),
    getAdminProblemJobs(),
  ]);

  const entries = Object.entries(lastRuns);
  const named = await addPreviewOwners(
    entries.flatMap(([, job]) => (job ? [toJsonAdminJob(job)] : [])),
  );
  const byId = new Map(named.map((job) => [job.id, job]));
  return {
    lastRuns: Object.fromEntries(
      entries.map(([kind, job]) => [kind, job ? byId.get(job.id)! : null]),
    ),
    summary,
    problems,
  };
};

/**
 * Each kind's latest failed runs. One shared limit would let a burst of one
 * kind hide another's failure, and zips are left out like everywhere else.
 */
export const getAdminProblemJobs = async () => {
  const perKind = await Promise.all(
    ADMIN_JOB_KINDS.map((kind) =>
      listAdminBackgroundJobItems({
        kind,
        status: ["failed", "dead"],
        limit: 20,
      }),
    ),
  );
  return addPreviewOwners(
    perKind
      .flat()
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .map(toJsonAdminJob),
  );
};

export const getAdminJobEvents = async (jobId: string) => {
  const [events, job] = await Promise.all([
    listBackgroundJobEvents({ jobId }),
    getPrisma().backgroundJob.findUnique({
      where: { id: jobId },
      select: { kind: true },
    }),
  ]);
  if (!job || !isPreviewJob(job)) return events;
  return events.map((event) =>
    ADMIN_EVENT_TYPES.has(event.type)
      ? event
      : { ...event, message: previewReason(event.message) },
  );
};

export const cancelAdminJob = async (jobId: string, actorUserId: string) =>
  cancelBackgroundJob({ jobId, actorUserId });

export const retryAdminJob = async (
  jobId: string,
  actorUserId: string,
  failedOnly = false,
) => retryBackgroundJob({ jobId, actorUserId, failedOnly });

export const dismissAdminJob = async (jobId: string, actorUserId: string) =>
  dismissBackgroundJob({ jobId, actorUserId });

export const enqueueAdminStagingCleanup = async (now = new Date()) =>
  ensureBackgroundJobScheduled({
    kind: STAGING_CLEANUP_JOB_KIND,
    runAt: now,
    payloadJson: { source: "admin-manual-trigger" },
    windowEnd: now,
    now,
  });

export const enqueueAdminTrashRetention = async (now = new Date()) =>
  ensureBackgroundJobScheduled({
    kind: TRASH_RETENTION_JOB_KIND,
    runAt: now,
    payloadJson: { source: "admin-manual-trigger" },
    windowEnd: now,
    now,
  });

const isFinishedAdminJob = (job: BackgroundJobRecord) =>
  job.status === "succeeded" ||
  job.status === "failed" ||
  job.status === "dead" ||
  job.status === "cancelled";

const selectRepresentativeAdminJob = (
  jobs: BackgroundJobRecord[],
  now = new Date(),
) =>
  jobs.find((job) => job.status === "running") ??
  jobs.find((job) => job.status === "queued" && job.runAt <= now) ??
  // A dismissed or cancelled run says less than the last real one.
  jobs.find((job) => isFinishedAdminJob(job) && job.status !== "cancelled") ??
  jobs.find(isFinishedAdminJob) ??
  jobs.find((job) => job.status === "queued") ??
  null;

const getLastRunPerKind = async () => {
  const now = new Date();
  const results = await Promise.all(
    ADMIN_JOB_KINDS.map(async (kind) => {
      const jobs = await listAdminBackgroundJobItems({ kind, limit: 100 });
      return { kind, job: selectRepresentativeAdminJob(jobs, now) };
    }),
  );
  return Object.fromEntries(
    results.map(({ kind, job }) => [kind, job]),
  ) as Record<string, (typeof results)[number]["job"]>;
};

const toJsonAdminJobListResponse = (
  response: AdminBackgroundJobListResult,
) => ({
  ...response,
  items: response.items.map(toJsonAdminJob),
});

const toJsonAdminJob = (item: BackgroundJobRecord) => ({
  ...item,
  payloadJson: item.payloadJson as Record<string, unknown> | null,
  runAt: item.runAt.toISOString(),
  lockedAt: item.lockedAt?.toISOString() ?? null,
  leaseExpiresAt: item.leaseExpiresAt?.toISOString() ?? null,
  timeoutAt: item.timeoutAt?.toISOString() ?? null,
  startedAt: item.startedAt?.toISOString() ?? null,
  completedAt: item.completedAt?.toISOString() ?? null,
  cancelledAt: item.cancelledAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

export const toJsonAdminJobSummary = (summary: QueueOperationalSummary) => ({
  ...summary,
  nextQueuedRunAt: summary.nextQueuedRunAt?.toISOString() ?? null,
  workers: summary.workers.map((worker) => ({
    ...worker,
    startedAt: worker.startedAt.toISOString(),
    lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
    stoppedAt: worker.stoppedAt?.toISOString() ?? null,
    createdAt: worker.createdAt.toISOString(),
    updatedAt: worker.updatedAt.toISOString(),
  })),
});

export const toJsonAdminJobStateSnapshot = (
  snapshot: Awaited<ReturnType<typeof getAdminJobStateSnapshot>>,
) => ({
  summary: toJsonAdminJobSummary(snapshot.summary),
  problems: snapshot.problems,
  lastRuns: snapshot.lastRuns,
});

/** The job list as JSON, with the owner's name on each preview job. */
export const getAdminJobListResponse = async (
  filters: ReturnType<typeof parseAdminJobFilters>,
) => {
  const response = toJsonAdminJobListResponse(
    await listAdminBackgroundJobs(filters),
  );
  return { ...response, items: await addPreviewOwners(response.items) };
};

// Preview jobs point at a member's file. Admins see whose drive it is and a
// plain reason, never the file name or the raw error, which holds its path.
const previewReason = (error: string | null) => {
  if (!error) return null;
  if (error === "Cancelled by admin.") return error;
  // Fixed text: a raw message can hold a path that happens to match.
  if (
    /durable storage mutation|Storage is busy|unfinished storage mutation/.test(
      error,
    )
  )
    return "Storage is busy. Try again shortly.";
  if (error.includes("not found or deleted")) return "The file was deleted.";
  if (/ffprobe|ffmpeg/.test(error)) return "Couldn't read this file.";
  return "Couldn't make a preview.";
};

// Events whose message Staaash writes itself, without any file detail.
const ADMIN_EVENT_TYPES = new Set([
  "queued",
  "claimed",
  "started",
  "succeeded",
  "cancelled",
  "cancel_ack",
  "retry_requested",
  "dismissed",
]);

const isPreviewJob = (job: { kind: string }) =>
  job.kind === MEDIA_DERIVATIVE_GENERATE_JOB_KIND;

const addPreviewOwners = async <
  T extends JsonAdminJobListResponse["items"][number],
>(
  items: T[],
) => {
  const fileIdOf = (job: T) =>
    isPreviewJob(job)
      ? (job.payloadJson as { fileId?: string } | null)?.fileId
      : undefined;
  const fileIds = items.map(fileIdOf).filter((id): id is string => Boolean(id));
  const files = fileIds.length
    ? await getPrisma().file.findMany({
        where: { id: { in: fileIds } },
        select: {
          id: true,
          owner: { select: { displayName: true, email: true } },
        },
      })
    : [];
  const owners = new Map(
    files.map((file) => [file.id, file.owner.displayName ?? file.owner.email]),
  );
  return items.map((job) => {
    if (!isPreviewJob(job)) return { ...job, ownerName: null };
    const fileId = fileIdOf(job);
    return {
      ...job,
      lastError: previewReason(job.lastError),
      ownerName: fileId ? (owners.get(fileId) ?? null) : null,
    };
  });
};

export const getAdminProblemJobIds = async (kind: string) => {
  const jobs = await getPrisma().backgroundJob.findMany({
    where: { kind, status: { in: ["failed", "dead"] } },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  return jobs.map((job) => job.id);
};
