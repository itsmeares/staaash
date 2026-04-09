import type { RestoreReconciliationRunRecord } from "@staaash/db/reconciliation";

import type {
  RestoreReconciliationHealthSummary,
  RestoreReconciliationReport,
} from "@/server/types";

export const createRestoreReconciliationReport = (
  report: Partial<RestoreReconciliationReport> = {},
): RestoreReconciliationReport => ({
  missingOriginalIds: report.missingOriginalIds ?? [],
  orphanedStorageKeys: report.orphanedStorageKeys ?? [],
});

export const hasRestoreIssues = (report: RestoreReconciliationReport) =>
  report.missingOriginalIds.length > 0 || report.orphanedStorageKeys.length > 0;

export const buildRestoreReconciliationHealthSummary = (
  run: RestoreReconciliationRunRecord | null,
): RestoreReconciliationHealthSummary => {
  if (!run) {
    return {
      status: "warning",
      runStatus: null,
      lastCompletedAt: null,
      missingOriginalCount: 0,
      orphanedStorageCount: 0,
      message: "Restore reconciliation has not completed yet.",
    };
  }

  if (run.status === "queued") {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: "Restore reconciliation is queued.",
    };
  }

  if (run.status === "running") {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: "Restore reconciliation is running.",
    };
  }

  if (run.status === "failed") {
    return {
      status: "error",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: run.lastError ?? "Restore reconciliation failed.",
    };
  }

  if (run.missingOriginalCount > 0 || run.orphanedStorageCount > 0) {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: `Latest reconciliation found ${run.missingOriginalCount} missing originals and ${run.orphanedStorageCount} orphaned storage files.`,
    };
  }

  return {
    status: "healthy",
    runStatus: run.status,
    lastCompletedAt: run.completedAt?.toISOString() ?? null,
    missingOriginalCount: 0,
    orphanedStorageCount: 0,
    message: "Latest reconciliation completed without integrity issues.",
  };
};
