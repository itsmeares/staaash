import { describe, expect, it, vi } from "vitest";

const listRecentRestoreReconciliationRuns = vi.fn();
const ensureBackgroundJobScheduled = vi.fn();
const createRestoreReconciliationRun = vi.fn();
const findRestoreReconciliationRunByBackgroundJobId = vi.fn();

vi.mock("@staaash/db/reconciliation", () => ({
  listRecentRestoreReconciliationRuns,
  createRestoreReconciliationRun,
  findRestoreReconciliationRunByBackgroundJobId,
}));

vi.mock("@staaash/db/jobs", () => ({
  RESTORE_RECONCILE_JOB_KIND: "restore.reconcile",
  ensureBackgroundJobScheduled,
}));

describe("admin integrity helpers", () => {
  it("builds a health-backed summary from recent runs", async () => {
    listRecentRestoreReconciliationRuns.mockResolvedValueOnce([
      {
        id: "run-1",
        status: "succeeded",
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-1",
        startedAt: new Date("2026-04-09T10:00:00.000Z"),
        completedAt: new Date("2026-04-09T10:01:00.000Z"),
        missingOriginalCount: 1,
        orphanedStorageCount: 0,
        details: {
          missingOriginals: [
            {
              fileId: "file-1",
              storageKey: "library/member/file-1.txt",
            },
          ],
          orphanedStorageKeys: [],
        },
        lastError: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        updatedAt: new Date("2026-04-09T10:01:00.000Z"),
      },
    ]);

    const { getAdminIntegritySummary } =
      await import("@/server/admin/integrity");
    const summary = await getAdminIntegritySummary();

    expect(summary.health.status).toBe("warning");
    expect(summary.latestRun?.id).toBe("run-1");
    expect(summary.hasActiveRun).toBe(false);
  });

  it("creates a persisted run only when scheduling creates a new job", async () => {
    ensureBackgroundJobScheduled.mockResolvedValueOnce({
      created: true,
      job: {
        id: "job-1",
      },
    });
    createRestoreReconciliationRun.mockResolvedValueOnce({
      id: "run-1",
    });

    const { enqueueAdminRestoreReconciliation } =
      await import("@/server/admin/integrity");

    const created = await enqueueAdminRestoreReconciliation("owner-1");

    expect(created.created).toBe(true);
    expect(createRestoreReconciliationRun).toHaveBeenCalledWith({
      triggeredByUserId: "owner-1",
      backgroundJobId: "job-1",
    });

    ensureBackgroundJobScheduled.mockResolvedValueOnce({
      created: false,
      job: {
        id: "job-2",
      },
    });
    findRestoreReconciliationRunByBackgroundJobId.mockResolvedValueOnce({
      id: "run-2",
    });

    const existing = await enqueueAdminRestoreReconciliation("owner-1");

    expect(existing.created).toBe(false);
    expect(findRestoreReconciliationRunByBackgroundJobId).toHaveBeenCalledWith(
      "job-2",
    );
  });
});
