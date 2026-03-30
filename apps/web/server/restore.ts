import type { RestoreReconciliationReport } from "@/server/types";

export const createRestoreReconciliationReport = (
  report: Partial<RestoreReconciliationReport> = {},
): RestoreReconciliationReport => ({
  missingOriginalIds: report.missingOriginalIds ?? [],
  previewRegenerationIds: report.previewRegenerationIds ?? [],
  orphanedStorageKeys: report.orphanedStorageKeys ?? [],
});

export const hasRestoreIssues = (report: RestoreReconciliationReport) =>
  report.missingOriginalIds.length > 0 ||
  report.previewRegenerationIds.length > 0 ||
  report.orphanedStorageKeys.length > 0;
