import {
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
} from "@staaash/db/jobs";

import type { JsonAdminJobListResponse } from "./types";

export const ADMIN_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
  "cancelled",
] as const;

export type AdminJobStatusFilter = (typeof ADMIN_JOB_STATUSES)[number];

export const parseAdminJobFilters = (params: {
  status?: string | null;
  kind?: string | null;
  cursor?: string | null;
  limit?: string | null;
}) => {
  const status = params.status?.trim() ?? "";
  const kind = params.kind?.trim() ?? "";

  return {
    status: ADMIN_JOB_STATUSES.includes(status as AdminJobStatusFilter)
      ? (status as AdminJobStatusFilter)
      : null,
    kind: ALL_SUPPORTED_JOB_KINDS.includes(
      kind as (typeof ALL_SUPPORTED_JOB_KINDS)[number],
    )
      ? kind
      : null,
    cursor: params.cursor?.trim() || null,
    limit: normalizeAdminJobLimit(params.limit),
  } satisfies Pick<
    AdminBackgroundJobListFilters,
    "status" | "kind" | "cursor" | "limit"
  >;
};

const normalizeAdminJobLimit = (limit?: string | null) => {
  const parsed = Number.parseInt(limit ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25;
};

export const getAdminJobList = async (
  filters: AdminBackgroundJobListFilters = {},
) => listAdminBackgroundJobs(filters);

export const getAdminJobSummary = async () => getQueueOperationalSummary();

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
      const res = await listAdminBackgroundJobs({ kind, limit: 100 });
      return { kind, job: selectRepresentativeAdminJob(res.items, now) };
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
  items: response.items.map((item) => ({
    ...item,
    runAt: item.runAt.toISOString(),
    lockedAt: item.lockedAt?.toISOString() ?? null,
    leaseExpiresAt: item.leaseExpiresAt?.toISOString() ?? null,
    timeoutAt: item.timeoutAt?.toISOString() ?? null,
    startedAt: item.startedAt?.toISOString() ?? null,
    completedAt: item.completedAt?.toISOString() ?? null,
    cancelledAt: item.cancelledAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  })),
});
