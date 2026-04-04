import os from "node:os";
import { mkdir } from "node:fs/promises";

import {
  PREVIEW_GENERATE_JOB_KIND,
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
  getWorkerStoragePaths,
  recoverPendingDeletes,
  writeHeartbeat,
} from "./storage-maintenance";
import { handleStagingCleanup } from "./handlers/staging-cleanup";
import { handleUpdateCheck } from "./handlers/update-check";
import { handlePreviewGenerate } from "./handlers/preview-generate";
import { handleTrashRetention } from "./handlers/trash-retention";

const storagePaths = getWorkerStoragePaths();
const workerId = `${os.hostname()}-${process.pid}`;
const workerHeartbeatMs = 30_000;
const jobPollMs = 10_000;

// How often each periodic job should run (in ms)
const TRASH_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const UPDATE_CHECK_INTERVAL_MS =
  Number(process.env.UPDATE_CHECK_INTERVAL_HOURS ?? 24) * 60 * 60 * 1000;

/**
 * Ensures all periodic jobs have at least one upcoming entry in the queue.
 * Called once on startup and after each successful execution so the queue
 * remains durable across worker restarts.
 */
const schedulePeriodicJobs = async (now = new Date()) => {
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
    windowEnd: new Date(now.getTime() + UPDATE_CHECK_INTERVAL_MS),
    now,
  });
};

/**
 * Re-schedules a periodic job for its next run after a successful execution.
 * This keeps the queue populated across restarts instead of relying on a clock.
 */
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
    case UPDATE_CHECK_JOB_KIND:
      await ensureBackgroundJobScheduled({
        kind: UPDATE_CHECK_JOB_KIND,
        runAt: nextRunAt,
        payloadJson: {},
        windowEnd: new Date(nextRunAt.getTime() + UPDATE_CHECK_INTERVAL_MS),
      });
      break;
  }
};

/**
 * Claims and dispatches exactly one due background job across all supported
 * kinds. Returns true if a job was processed, false if the queue was empty.
 */
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
          UPDATE_CHECK_INTERVAL_MS,
        );
        break;

      case PREVIEW_GENERATE_JOB_KIND:
        await handlePreviewGenerate(job, storagePaths.filesRoot);
        break;

      default:
        // Unknown kind — mark as succeeded to avoid accumulation
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

    // If a preview job just dead-lettered, flip the file status to failed
    if (
      job.kind === PREVIEW_GENERATE_JOB_KIND &&
      updatedJob.status === "dead"
    ) {
      try {
        await handlePreviewGenerate(job, storagePaths.filesRoot, true);
      } catch {
        // Best-effort — don't crash the worker if status update fails
      }
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

  // Process any immediately due jobs on startup
  await processNextJob();
};

void main();
