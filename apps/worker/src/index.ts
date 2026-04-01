import os from "node:os";
import { mkdir } from "node:fs/promises";

import {
  claimDueBackgroundJob,
  ensureBackgroundJobScheduled,
  markBackgroundJobFailed,
  markBackgroundJobSucceeded,
  STAGING_CLEANUP_JOB_KIND,
  STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
} from "@staaash/db/jobs";
import {
  cleanupExpiredStagingFiles,
  getWorkerStoragePaths,
  recoverPendingDeletes,
  writeHeartbeat,
} from "./storage-maintenance";

const storagePaths = getWorkerStoragePaths();
const workerId = `${os.hostname()}-${process.pid}`;
const workerHeartbeatMs = 30_000;
const jobPollMs = 10_000;

const ensureCleanupJobDue = async () => {
  await ensureBackgroundJobScheduled({
    kind: STAGING_CLEANUP_JOB_KIND,
    runAt: new Date(),
    payloadJson: {},
    windowEnd: new Date(Date.now() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
  });
};

const runMaintenance = async () => {
  await recoverPendingDeletes({
    pendingDeleteRoot: storagePaths.pendingDeleteRoot,
  });
};

const runCleanupJobOnce = async () => {
  const job = await claimDueBackgroundJob({
    kind: STAGING_CLEANUP_JOB_KIND,
    workerId,
  });

  if (!job) {
    return;
  }

  try {
    await cleanupExpiredStagingFiles({
      tmpRoot: storagePaths.tmpRoot,
      ttlMs: storagePaths.uploadStagingTtlMs,
    });
    await markBackgroundJobSucceeded({
      jobId: job.id,
    });
  } catch (error) {
    await markBackgroundJobFailed({
      jobId: job.id,
      errorMessage:
        error instanceof Error ? error.message : "Unknown worker error.",
    });
  }
};

const main = async () => {
  await mkdir(storagePaths.tmpRoot, { recursive: true });
  await writeHeartbeat(storagePaths.heartbeatPath);
  await ensureCleanupJobDue();

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
      .then(() => runCleanupJobOnce())
      .finally(() => {
        polling = false;
      });
  }, jobPollMs);

  await runMaintenance();
  await runCleanupJobOnce();
};

void main();
