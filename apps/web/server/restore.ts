import type { RestoreReconciliationRunRecord } from "@staaash/db/reconciliation";

import type { RestoreReconciliationHealthSummary } from "@/server/types";

const incompleteCheckMessage = (
  details: RestoreReconciliationRunRecord["details"],
) => {
  if (details.uncheckedOriginalCount)
    return `Restore check could not verify ${details.uncheckedOriginalCount} originals while storage operations were in progress.`;
  if (details.checksumMismatches?.length)
    return `Restore check found ${details.checksumMismatches.length} originals with incorrect checksums.`;
  if (details.recoveryRequiredMutations?.length)
    return "Storage operations require recovery.";
  return null;
};

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
      message: "Restore check has not completed yet.",
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

  const warning = incompleteCheckMessage(run.details);
  if (warning) {
    return {
      status: "warning",
      runStatus: run.status,
      lastCompletedAt: run.completedAt?.toISOString() ?? null,
      missingOriginalCount: run.missingOriginalCount,
      orphanedStorageCount: run.orphanedStorageCount,
      message: warning,
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
