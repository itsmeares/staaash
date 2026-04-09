import {
  listAdminBackgroundJobs,
  type AdminBackgroundJobListFilters,
  type AdminBackgroundJobListResult,
} from "@staaash/db/admin";
import { ALL_SUPPORTED_JOB_KINDS } from "@staaash/db/jobs";

import type { JsonAdminJobListResponse } from "./types";

export const ADMIN_JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "dead",
] as const;

export type AdminJobStatusFilter = (typeof ADMIN_JOB_STATUSES)[number];

export const parseAdminJobFilters = (params: {
  status?: string | null;
  kind?: string | null;
  cursor?: string | null;
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
  } satisfies Pick<AdminBackgroundJobListFilters, "status" | "kind" | "cursor">;
};

export const getAdminJobList = async (
  filters: AdminBackgroundJobListFilters = {},
) => listAdminBackgroundJobs(filters);

export const toJsonAdminJobListResponse = (
  response: AdminBackgroundJobListResult,
): JsonAdminJobListResponse => ({
  ...response,
  items: response.items.map((item) => ({
    ...item,
    runAt: item.runAt.toISOString(),
    lockedAt: item.lockedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  })),
});
