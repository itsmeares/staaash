import { access, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

import {
  getQueueBacklogSummary,
  probeDatabaseReachability,
} from "@staaash/db/health";
import { readInstanceUpdateCheck } from "@staaash/db/instance";
import { readLatestRestoreReconciliationRun } from "@staaash/db/reconciliation";

import { env } from "@/lib/env";
import { buildRestoreReconciliationHealthSummary } from "@/server/restore";
import {
  ensureStorageDirectories,
  getStorageRoot,
  getWorkerHeartbeatPath,
} from "@/server/storage";
import type {
  HealthCheckStatus,
  InstanceHealthSummary,
  JsonInstanceHealthSummary,
  StorageWarningSummary,
  RestoreReconciliationHealthSummary,
  WorkerHeartbeatStatus,
} from "@/server/types";

type HeartbeatPayload = {
  timestamp: string;
};

const toStorageWarningSummary = (
  availableBytes: bigint | null,
  totalBytes: bigint | null,
): StorageWarningSummary => {
  if (availableBytes === null || totalBytes === null || totalBytes === 0n) {
    return {
      status: "warning",
      freeBytes: availableBytes,
      totalBytes,
      message: "Disk statistics are unavailable.",
    };
  }

  const ratio = Number(availableBytes) / Number(totalBytes);

  if (ratio <= 0.1) {
    return {
      status: "warning",
      freeBytes: availableBytes,
      totalBytes,
      message: "Available disk space is low.",
    };
  }

  return {
    status: "healthy",
    freeBytes: availableBytes,
    totalBytes,
    message: "Disk capacity is healthy.",
  };
};

export const getWorkerHeartbeatStatus = (
  lastSeenAt: Date | null,
  now = new Date(),
  maxAgeMs = env.WORKER_HEARTBEAT_MAX_AGE_SECONDS * 1000,
): WorkerHeartbeatStatus => {
  if (!lastSeenAt) {
    return {
      status: "warning",
      lastSeenAt: null,
      message: "Worker heartbeat has not been observed yet.",
    };
  }

  const ageMs = now.getTime() - lastSeenAt.getTime();

  if (ageMs > maxAgeMs) {
    return {
      status: "error",
      lastSeenAt: lastSeenAt.toISOString(),
      message: "Worker heartbeat is stale.",
    };
  }

  return {
    status: "healthy",
    lastSeenAt: lastSeenAt.toISOString(),
    message: "Worker heartbeat is current.",
  };
};

const readWorkerHeartbeat = async () => {
  try {
    const payload = JSON.parse(
      await readFile(getWorkerHeartbeatPath(), "utf8"),
    ) as HeartbeatPayload;
    return new Date(payload.timestamp);
  } catch {
    return null;
  }
};

const probeStorage = async () => {
  try {
    await ensureStorageDirectories();
    await access(getStorageRoot(), constants.R_OK | constants.W_OK);
    return {
      status: "healthy" as const,
    };
  } catch (error) {
    return {
      status: "error" as const,
      message:
        error instanceof Error
          ? error.message
          : "Storage root is not writable.",
    };
  }
};

const getStorageWarnings = async () => {
  try {
    const stats = await statfs(getStorageRoot());
    const availableBytes = BigInt(stats.bavail) * BigInt(stats.bsize);
    const totalBytes = BigInt(stats.blocks) * BigInt(stats.bsize);
    return toStorageWarningSummary(availableBytes, totalBytes);
  } catch {
    return toStorageWarningSummary(null, null);
  }
};

export const writeWorkerHeartbeat = async (timestamp = new Date()) => {
  await ensureStorageDirectories();
  await mkdir(getStorageRoot(), { recursive: true });
  await writeFile(
    getWorkerHeartbeatPath(),
    JSON.stringify({
      timestamp: timestamp.toISOString(),
    }),
    "utf8",
  );
};

export const buildInstanceHealthSummary = ({
  databaseStatus,
  databaseMessage,
  storageStatus,
  storageMessage,
  worker,
  queue,
  reconciliation,
  storageWarnings,
  versionInfo,
}: {
  databaseStatus: HealthCheckStatus;
  databaseMessage?: string;
  storageStatus: HealthCheckStatus;
  storageMessage?: string;
  worker: WorkerHeartbeatStatus;
  queue: InstanceHealthSummary["queue"];
  reconciliation: RestoreReconciliationHealthSummary;
  storageWarnings: StorageWarningSummary;
  versionInfo: InstanceHealthSummary["version"];
}): InstanceHealthSummary => {
  const ok =
    databaseStatus === "healthy" &&
    storageStatus === "healthy" &&
    worker.status !== "error" &&
    queue.status !== "error" &&
    reconciliation.status !== "error";

  return {
    ok,
    checks: {
      app: {
        status: "healthy",
      },
      database: {
        status: databaseStatus,
        message: databaseMessage,
      },
      storage: {
        status: storageStatus,
        message: storageMessage,
      },
    },
    worker,
    queue,
    reconciliation,
    storageWarnings,
    version: versionInfo,
  };
};

export const getReadiness = async () => {
  const [
    database,
    storage,
    heartbeat,
    queue,
    storageWarnings,
    instanceState,
    latestReconciliationRun,
  ] = await Promise.all([
    probeDatabaseReachability(env.DATABASE_URL),
    probeStorage(),
    readWorkerHeartbeat(),
    getQueueBacklogSummary(env.DATABASE_URL),
    getStorageWarnings(),
    readInstanceUpdateCheck().catch(() => null),
    readLatestRestoreReconciliationRun().catch(() => null),
  ]);

  return buildInstanceHealthSummary({
    databaseStatus: database.status,
    databaseMessage: database.message,
    storageStatus: storage.status,
    storageMessage: storage.message,
    worker: getWorkerHeartbeatStatus(heartbeat),
    queue,
    reconciliation: buildRestoreReconciliationHealthSummary(
      latestReconciliationRun,
    ),
    storageWarnings,
    versionInfo: {
      currentVersion: env.APP_VERSION,
      lastUpdateCheckAt:
        instanceState?.lastUpdateCheckAt?.toISOString() ?? null,
      updateCheckStatus: instanceState?.updateCheckStatus ?? null,
      updateCheckMessage: instanceState?.updateCheckMessage ?? null,
      latestAvailableVersion: instanceState?.latestAvailableVersion ?? null,
    },
  });
};

export const getAdminHealthSummary = async () => getReadiness();

export const toJsonInstanceHealthSummary = (
  summary: InstanceHealthSummary,
): JsonInstanceHealthSummary => ({
  ...summary,
  storageWarnings: {
    ...summary.storageWarnings,
    freeBytes: summary.storageWarnings.freeBytes?.toString() ?? null,
    totalBytes: summary.storageWarnings.totalBytes?.toString() ?? null,
  },
});
