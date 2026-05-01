import os from "node:os";
import { mkdir } from "node:fs/promises";

import {
  RESTORE_RECONCILE_JOB_KIND,
  STAGING_CLEANUP_JOB_KIND,
  STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
  TRASH_RETENTION_JOB_KIND,
  UPDATE_CHECK_JOB_KIND,
  claimDueBackgroundJob,
  ensureBackgroundJobScheduled,
  markBackgroundJobFailed,
  markBackgroundJobSucceeded,
} from "@staaash/db/jobs";
import {
  failRestoreReconciliationRun,
  markRestoreReconciliationRunQueued,
} from "@staaash/db/reconciliation";

import {
  getWorkerStoragePaths,
  recoverPendingDeletes,
  writeHeartbeat,
} from "./storage-maintenance";
import { handleStagingCleanup } from "./handlers/staging-cleanup";
import { handleRestoreReconciliation } from "./handlers/restore-reconciliation";
import { handleTrashRetention } from "./handlers/trash-retention";
import { handleUpdateCheck } from "./handlers/update-check";

const storagePaths = getWorkerStoragePaths();
const workerId = `${os.hostname()}-${process.pid}`;
const workerHeartbeatMs = 30_000;
const jobPollMs = 10_000;

const TRASH_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

const getUpdateCheckIntervalMs = async (): Promise<number> => {
  try {
    const { getPrisma } = await import("@staaash/db/client");
    const db = getPrisma();
    const settings = await db.systemSettings.findUnique({
      where: { id: "singleton" },
    });
    return (settings?.updateCheckIntervalHours ?? 24) * 60 * 60 * 1000;
  } catch {
    return DEFAULT_UPDATE_CHECK_INTERVAL_MS;
  }
};

const schedulePeriodicJobs = async (now = new Date()) => {
  const updateCheckIntervalMs = await getUpdateCheckIntervalMs();

  await ensureBackgroundJobScheduled({
    kind: STAGING_CLEANUP_JOB_KIND,
    runAt: now,
    payloadJson: {},
    windowEnd: new Date(now.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
    now,
  });

  await ensureBackgroundJobScheduled({
    kind: TRASH_RETENTION_JOB_KIND,
    runAt: now,
    payloadJson: {},
    windowEnd: new Date(now.getTime() + TRASH_RETENTION_INTERVAL_MS),
    now,
  });

  await ensureBackgroundJobScheduled({
    kind: UPDATE_CHECK_JOB_KIND,
    runAt: now,
    payloadJson: {},
    windowEnd: new Date(now.getTime() + updateCheckIntervalMs),
    now,
  });
};

const reschedulePeriodicJob = async (kind: string, intervalMs: number) => {
  const nextRunAt = new Date(Date.now() + intervalMs);

  switch (kind) {
    case STAGING_CLEANUP_JOB_KIND:
      await ensureBackgroundJobScheduled({
        kind: STAGING_CLEANUP_JOB_KIND,
        runAt: nextRunAt,
        payloadJson: {},
        windowEnd: new Date(
          nextRunAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
        ),
      });
      break;
    case TRASH_RETENTION_JOB_KIND:
      await ensureBackgroundJobScheduled({
        kind: TRASH_RETENTION_JOB_KIND,
        runAt: nextRunAt,
        payloadJson: {},
        windowEnd: new Date(nextRunAt.getTime() + TRASH_RETENTION_INTERVAL_MS),
      });
      break;
    case UPDATE_CHECK_JOB_KIND: {
      const intervalMs = await getUpdateCheckIntervalMs();
      await ensureBackgroundJobScheduled({
        kind: UPDATE_CHECK_JOB_KIND,
        runAt: nextRunAt,
        payloadJson: {},
        windowEnd: new Date(nextRunAt.getTime() + intervalMs),
      });
      break;
    }
  }
};

const processNextJob = async (): Promise<boolean> => {
  const job = await claimDueBackgroundJob({ workerId });

  if (!job) {
    return false;
  }

  try {
    switch (job.kind) {
      case STAGING_CLEANUP_JOB_KIND:
        await handleStagingCleanup(job, storagePaths);
        await reschedulePeriodicJob(
          STAGING_CLEANUP_JOB_KIND,
          STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
        );
        break;

      case TRASH_RETENTION_JOB_KIND:
        await handleTrashRetention(job);
        await reschedulePeriodicJob(
          TRASH_RETENTION_JOB_KIND,
          TRASH_RETENTION_INTERVAL_MS,
        );
        break;

      case UPDATE_CHECK_JOB_KIND:
        await handleUpdateCheck(job);
        await reschedulePeriodicJob(
          UPDATE_CHECK_JOB_KIND,
          await getUpdateCheckIntervalMs(),
        );
        break;

      case RESTORE_RECONCILE_JOB_KIND:
        await handleRestoreReconciliation(job, storagePaths);
        break;

      default:
        console.warn(`[worker] Unknown job kind: ${job.kind} — skipping.`);
    }

    await markBackgroundJobSucceeded({ jobId: job.id });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown worker error.";
    const updatedJob = await markBackgroundJobFailed({
      jobId: job.id,
      errorMessage,
    });

    if (job.kind === RESTORE_RECONCILE_JOB_KIND) {
      if (updatedJob.status === "queued") {
        await markRestoreReconciliationRunQueued({
          backgroundJobId: job.id,
          errorMessage,
        });
      } else if (updatedJob.status === "dead") {
        await failRestoreReconciliationRun({
          backgroundJobId: job.id,
          errorMessage,
        });
      }
    }

    if (updatedJob.status === "dead") {
      console.error("[worker] Background job dead-lettered after retries.", {
        jobId: job.id,
        kind: job.kind,
        error: errorMessage,
      });
    } else {
      console.warn("[worker] Background job retried.", {
        jobId: job.id,
        kind: job.kind,
        error: errorMessage,
      });
    }
  }

  return true;
};

const runMaintenance = async () => {
  await recoverPendingDeletes({
    pendingDeleteRoot: storagePaths.pendingDeleteRoot,
  });
};

const main = async () => {
  await mkdir(storagePaths.tmpRoot, { recursive: true });
  await writeHeartbeat(storagePaths.heartbeatPath);
  await schedulePeriodicJobs();
  await runMaintenance();

  let polling = false;

  setInterval(() => {
    void writeHeartbeat(storagePaths.heartbeatPath);
  }, workerHeartbeatMs);

  setInterval(() => {
    if (polling) {
      return;
    }

    polling = true;

    void runMaintenance()
      .then(() => processNextJob())
      .finally(() => {
        polling = false;
      });
  }, jobPollMs);

  await processNextJob();
};

void main();
