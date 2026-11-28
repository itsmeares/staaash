import type { RestoreReconciliationRunRecord } from "@staaash/db/reconciliation";

import type { RestoreReconciliationHealthSummary } from "@/server/types";

export const buildRestoreReconciliationHealthSummary = (
  run: RestoreReconciliationRunRecord | null,
): RestoreReconciliationHealthSummary => {
  // The check only runs when an admin starts it, so most instances never
  // need it. Never having run is not a problem to report.
  if (!run) {
    return {
      status: "healthy",
      runStatus: null,
      lastCompletedAt: null,
      missingOriginalCount: 0,
      orphanedStorageCount: 0,
      message: "Not run yet. Run it after a restore.",
    };
  }

  if (run.status === "queued") {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: "Restore check is queued.",
    };
  }

  if (run.status === "running") {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: "Restore check is running.",
    };
  }

  if (run.status === "failed") {
    return {
      status: "error",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: run.lastError ?? "Restore check failed.",
    };
  }

  if (run.missingOriginalCount > 0 || run.orphanedStorageCount > 0) {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: `Latest restore check found ${run.missingOriginalCount} missing originals and ${run.orphanedStorageCount} orphaned storage files.`,
    };
  }

  return {
    status: "healthy",
    runStatus: run.status,
    lastCompletedAt: run.completedAt?.toISOString() ?? null,
    missingOriginalCount: 0,
    orphanedStorageCount: 0,
    message: "Latest restore check completed without issues.",
  };
};
