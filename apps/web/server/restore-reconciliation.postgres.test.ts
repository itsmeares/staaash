import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import {
  ensureRestoreReconciliationRun,
  markRestoreReconciliationRunRunning,
} from "@staaash/db/reconciliation";

it("concurrent API and worker creation keeps one restore check without resetting progress", async () => {
  const db = getPrisma();
  const job = await db.backgroundJob.create({
    data: { kind: "restore.reconcile", payloadJson: {}, runAt: new Date() },
  });
  const runs = await Promise.all(
    Array.from({ length: 8 }, () =>
      ensureRestoreReconciliationRun({
        backgroundJobId: job.id,
        triggeredByUserId: null,
      }),
    ),
  );
  expect(new Set(runs.map((run) => run.id)).size).toBe(1);
  expect(
    await db.restoreReconciliationRun.count({
      where: { backgroundJobId: job.id },
    }),
  ).toBe(1);
  await markRestoreReconciliationRunRunning({ backgroundJobId: job.id });
  expect(
    await ensureRestoreReconciliationRun({
      backgroundJobId: job.id,
      triggeredByUserId: null,
    }),
  ).toMatchObject({ id: runs[0].id, status: "running" });
});
