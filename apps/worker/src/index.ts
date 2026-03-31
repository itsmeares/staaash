import os from "node:os";
import path from "node:path";
import { mkdir, opendir, rm, stat, writeFile } from "node:fs/promises";

import {
  claimDueBackgroundJob,
  ensureBackgroundJobScheduled,
  markBackgroundJobFailed,
  markBackgroundJobSucceeded,
  STAGING_CLEANUP_JOB_KIND,
  STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
} from "@staaash/db/jobs";
import { z } from "zod";

const envSchema = z.object({
  FILES_ROOT: z.string().trim().min(1),
  UPLOAD_STAGING_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
});

const env = envSchema.parse(process.env);
const filesRoot = path.resolve(process.cwd(), env.FILES_ROOT);
const tmpRoot = path.resolve(filesRoot, "tmp");
const heartbeatPath = path.resolve(tmpRoot, "worker-heartbeat.json");
const workerId = `${os.hostname()}-${process.pid}`;
const workerHeartbeatMs = 30_000;
const jobPollMs = 10_000;
const uploadStagingTtlMs = env.UPLOAD_STAGING_RETENTION_HOURS * 60 * 60 * 1000;

const writeHeartbeat = async () => {
  await mkdir(tmpRoot, { recursive: true });
  await writeFile(
    heartbeatPath,
    JSON.stringify({
      timestamp: new Date().toISOString(),
    }),
    "utf8",
  );
};

const shouldCleanupStagedUpload = (createdAt: Date, now = new Date()) =>
  now.getTime() - createdAt.getTime() >= uploadStagingTtlMs;

const cleanupExpiredStagingFiles = async (now = new Date()) => {
  await mkdir(tmpRoot, { recursive: true });
  const directory = await opendir(tmpRoot);

  for await (const entry of directory) {
    if (!entry.isFile() || !entry.name.endsWith(".upload")) {
      continue;
    }

    const absolutePath = path.join(tmpRoot, entry.name);
    const stats = await stat(absolutePath);

    if (!shouldCleanupStagedUpload(stats.mtime, now)) {
      continue;
    }

    await rm(absolutePath, {
      force: true,
    });
  }
};

const ensureCleanupJobDue = async () => {
  await ensureBackgroundJobScheduled({
    kind: STAGING_CLEANUP_JOB_KIND,
    runAt: new Date(),
    payloadJson: {},
    windowEnd: new Date(Date.now() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
  });
};

const runOnce = async () => {
  const job = await claimDueBackgroundJob({
    kind: STAGING_CLEANUP_JOB_KIND,
    workerId,
  });

  if (!job) {
    return;
  }

  try {
    await cleanupExpiredStagingFiles();
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
  await mkdir(tmpRoot, { recursive: true });
  await writeHeartbeat();
  await ensureCleanupJobDue();

  let polling = false;

  setInterval(() => {
    void writeHeartbeat();
  }, workerHeartbeatMs);

  setInterval(() => {
    if (polling) {
      return;
    }

    polling = true;

    void runOnce().finally(() => {
      polling = false;
    });
  }, jobPollMs);

  await runOnce();
};

void main();
