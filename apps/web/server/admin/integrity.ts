import {
  RESTORE_RECONCILE_JOB_KIND,
  ensureBackgroundJobScheduled,
} from "@staaash/db/jobs";
import {
  createRestoreReconciliationRun,
  findRestoreReconciliationRunByBackgroundJobId,
  listRecentRestoreReconciliationRuns,
  readLatestRestoreReconciliationRun,
} from "@staaash/db/reconciliation";

import { buildRestoreReconciliationHealthSummary } from "@/server/restore";

import type { AdminIntegritySummary, JsonAdminIntegritySummary } from "./types";

const RESTORE_RECONCILE_DEDUPE_KEY = "restore.reconcile.manual";

const toJsonAdminRestoreReconciliationRun = (
  run: NonNullable<AdminIntegritySummary["latestRun"]>,
) => ({
  ...run,
  startedAt: run.startedAt?.toISOString() ?? null,
  completedAt: run.completedAt?.toISOString() ?? null,
  createdAt: run.createdAt.toISOString(),
  updatedAt: run.updatedAt.toISOString(),
});

export const getAdminIntegritySummary =
  async (): Promise<AdminIntegritySummary> => {
    const recentRuns = await listRecentRestoreReconciliationRuns({
      limit: 5,
    });
    const latestRun = recentRuns[0] ?? null;

    return {
      health: buildRestoreReconciliationHealthSummary(latestRun),
      latestRun,
      recentRuns,
      hasActiveRun:
        latestRun?.status === "queued" || latestRun?.status === "running",
    };
  };

export const enqueueAdminRestoreReconciliation = async (
  actorUserId: string,
  now = new Date(),
) => {
  const result = await ensureBackgroundJobScheduled({
    kind: RESTORE_RECONCILE_JOB_KIND,
    dedupeKey: RESTORE_RECONCILE_DEDUPE_KEY,
    runAt: now,
    payloadJson: {
      source: "admin-manual-restore-reconcile",
      triggeredByUserId: actorUserId,
    },
    windowEnd: now,
    now,
  });

  const run = result.created
    ? await createRestoreReconciliationRun({
        triggeredByUserId: actorUserId,
        backgroundJobId: result.job.id,
      })
    : await findRestoreReconciliationRunByBackgroundJobId(result.job.id);

  return {
    ...result,
    run,
  };
};

export const toJsonAdminIntegritySummary = (
  summary: AdminIntegritySummary,
): JsonAdminIntegritySummary => ({
  ...summary,
  latestRun: summary.latestRun
    ? toJsonAdminRestoreReconciliationRun(summary.latestRun)
    : null,
  recentRuns: summary.recentRuns.map(toJsonAdminRestoreReconciliationRun),
});
