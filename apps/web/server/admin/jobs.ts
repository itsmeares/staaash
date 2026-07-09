import {
  listAdminBackgroundJobItems,
  listAdminBackgroundJobs,
  type AdminBackgroundJobListFilters,
  type AdminBackgroundJobListResult,
} from "@staaash/db/admin";
import {
  ALL_SUPPORTED_JOB_KINDS,
  STAGING_CLEANUP_JOB_KIND,
  TRASH_RETENTION_JOB_KIND,
  cancelBackgroundJob,
  ensureBackgroundJobScheduled,
  getQueueOperationalSummary,
  listBackgroundJobEvents,
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

export const getAdminJobList = async (
  filters: AdminBackgroundJobListFilters = {},
) => listAdminBackgroundJobs(filters);

export const getAdminJobSummary = async () => getQueueOperationalSummary();

export const getAdminJobStateSnapshot = async () => {
  const [lastRuns, summary] = await Promise.all([
    getLastRunPerKind(),
    getAdminJobSummary(),
  ]);

  return { lastRuns, summary };
};

export const getAdminJobEvents = async (jobId: string) =>
  listBackgroundJobEvents({ jobId });

export const cancelAdminJob = async (jobId: string, actorUserId: string) =>
  cancelBackgroundJob({ jobId, actorUserId });

export const retryAdminJob = async (jobId: string, actorUserId: string) =>
  retryBackgroundJob({ jobId, actorUserId });

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

export const getLastRunPerKind = async () => {
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

export const toJsonAdminJobListResponse = (
  response: AdminBackgroundJobListResult,
): JsonAdminJobListResponse => ({
  ...response,
  items: response.items.map(toJsonAdminJob),
});

export const toJsonAdminJob = (item: BackgroundJobRecord) => ({
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
  lastRuns: Object.fromEntries(
    Object.entries(snapshot.lastRuns).map(([kind, job]) => [
      kind,
      job ? toJsonAdminJob(job) : null,
    ]),
  ),
});
