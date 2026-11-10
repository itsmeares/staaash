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
    getAdminJobListResponse(
      parseAdminJobFilters({ status: "failed,dead", limit: "20" }),
    ),
  ]);

  const entries = Object.entries(lastRuns);
  const named = await addJobFileNames(
    entries.flatMap(([, job]) => (job ? [toJsonAdminJob(job)] : [])),
  );
  const byId = new Map(named.map((job) => [job.id, job]));
  return {
    lastRuns: Object.fromEntries(
      entries.map(([kind, job]) => [kind, job ? byId.get(job.id)! : null]),
    ),
    summary,
    problems: problems.items,
  };
};

export const getAdminJobEvents = async (jobId: string) =>
  listBackgroundJobEvents({ jobId });

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
  jobs.find(isFinishedAdminJob) ??
  jobs.find((job) => job.status === "queued") ??
  null;

const getLastRunPerKind = async () => {
  const now = new Date();
  const results = await Promise.all(
    ALL_SUPPORTED_JOB_KINDS.map(async (kind) => {
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

/** The job list as JSON, with the file name on each preview job. */
export const getAdminJobListResponse = async (
  filters: ReturnType<typeof parseAdminJobFilters>,
) => {
  const response = toJsonAdminJobListResponse(
    await listAdminBackgroundJobs(filters),
  );
  return { ...response, items: await addJobFileNames(response.items) };
};

const addJobFileNames = async <
  T extends JsonAdminJobListResponse["items"][number],
>(
  items: T[],
) => {
  const fileIdOf = (job: (typeof items)[number]) =>
    job.kind === MEDIA_DERIVATIVE_GENERATE_JOB_KIND
      ? (job.payloadJson as { fileId?: string } | null)?.fileId
      : undefined;
  const fileIds = items.map(fileIdOf).filter((id): id is string => Boolean(id));
  if (fileIds.length === 0)
    return items.map((job) => ({ ...job, fileName: null }));

  const files = await getPrisma().file.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, originalName: true },
  });
  const names = new Map(files.map((file) => [file.id, file.originalName]));
  return items.map((job) => {
    if (job.kind !== MEDIA_DERIVATIVE_GENERATE_JOB_KIND)
      return { ...job, fileName: null };
    const fileId = fileIdOf(job);
    return { ...job, fileName: fileId ? (names.get(fileId) ?? null) : null };
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
