import {
  getAdminStorageUsageSummary as getDbAdminStorageUsageSummary,
  type AdminStorageUsageSummary,
} from "@staaash/db/admin";

import type { JsonAdminStorageSummary } from "./types";

export const getAdminStorageSummary = async () => {
  const summary = await getDbAdminStorageUsageSummary();

  return {
    ...summary,
    rows: [...summary.rows].sort(
      (left, right) =>
        (right.retainedBytes > left.retainedBytes
          ? 1
          : right.retainedBytes < left.retainedBytes
            ? -1
            : 0) || left.username.localeCompare(right.username),
    ),
  } satisfies AdminStorageUsageSummary;
};

export const toJsonAdminStorageSummary = (
  summary: AdminStorageUsageSummary,
): JsonAdminStorageSummary => ({
  ...summary,
  retainedBytes: summary.retainedBytes.toString(),
  rows: summary.rows.map((row) => ({
    ...row,
    retainedBytes: row.retainedBytes.toString(),
    createdAt: row.createdAt.toISOString(),
    lastContentActivityAt: row.lastContentActivityAt?.toISOString() ?? null,
  })),
});
