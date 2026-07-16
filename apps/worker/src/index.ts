import os from "node:os";
import { mkdir } from "node:fs/promises";

import {
  markWorkerInstanceStopped,
  registerWorkerInstance,
} from "@staaash/db/jobs";
import { resolveRuntimeVersion } from "@staaash/config/version";

import { version as packageVersion } from "../package.json" with { type: "json" };

import {
  getWorkerStoragePaths,
  recoverPendingDeletes,
  writeHeartbeat,
} from "./storage-maintenance.js";
import { detectFfmpeg } from "./ffmpeg.js";
import { schedulePeriodicJobs } from "./job-registry.js";
import { WorkerRunner } from "./runner.js";

const storagePaths = getWorkerStoragePaths();
const workerId = `${os.hostname()}-${process.pid}-${Date.now()}`;
const workerVersion = resolveRuntimeVersion({
  packageVersion,
  appVersion: process.env.APP_VERSION,
});
const workerHeartbeatMs = 30_000;
const maintenanceMs = 60_000;

const runMaintenance = async () => {
  await recoverPendingDeletes({
    pendingDeleteRoot: storagePaths.pendingDeleteRoot,
  });
};

const main = async () => {
  await mkdir(storagePaths.tmpRoot, { recursive: true });
  await writeHeartbeat(storagePaths.heartbeatPath);

  await registerWorkerInstance({
    id: workerId,
    hostname: os.hostname(),
    pid: process.pid,
    version: workerVersion,
    metadataJson: {
      platform: process.platform,
      node: process.version,
    },
  });

  const ffmpegHealth = await detectFfmpeg();
  if (!ffmpegHealth.available) {
    console.warn(
      "[worker] FFmpeg not available — media preview generation disabled.",
      { error: ffmpegHealth.lastProbeError },
    );
  } else {
    console.info("[worker] FFmpeg detected.", {
      ffmpegVersion: ffmpegHealth.ffmpegVersion,
      ffprobeVersion: ffmpegHealth.ffprobeVersion,
    });
  }

  await schedulePeriodicJobs(new Date(), { runMissingImmediately: true });
  await runMaintenance();

  const heartbeatTimer = setInterval(() => {
    void writeHeartbeat(storagePaths.heartbeatPath);
  }, workerHeartbeatMs);

  const maintenanceTimer = setInterval(() => {
    void runMaintenance().catch((error) => {
      console.warn("[worker] Maintenance failed.", {
        error: error instanceof Error ? error.message : "Unknown error.",
      });
    });
  }, maintenanceMs);

  const runner = new WorkerRunner({ workerId, storagePaths });

  const stop = async (signal: NodeJS.Signals) => {
    console.info("[worker] Shutdown requested.", { signal });
    clearInterval(heartbeatTimer);
    clearInterval(maintenanceTimer);
    await runner.stop();
    await markWorkerInstanceStopped({ id: workerId }).catch(() => undefined);
    process.exit(0);
  };

  process.once("SIGINT", (signal) => void stop(signal));
  process.once("SIGTERM", (signal) => void stop(signal));

  await runner.start();
};

void main().catch((error) => {
  console.error("[worker] Fatal startup error.", {
    error: error instanceof Error ? error.message : "Unknown error.",
  });
  process.exit(1);
});
