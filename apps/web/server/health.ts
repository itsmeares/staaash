import { access, mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { constants } from "node:fs";

import {
  getQueueBacklogSummary,
  probeDatabaseReachability,
} from "@staaash/db/health";
import { readInstanceUpdateCheck } from "@staaash/db/instance";
import { listWorkerInstances } from "@staaash/db/jobs";
import { readLatestRestoreReconciliationRun } from "@staaash/db/reconciliation";
import { getStorageMutationHealth } from "@staaash/db/storage-mutations";
import { assertStorageFilesystemSupported } from "@staaash/db/storage-mutation-executor";
import { getPrisma } from "@staaash/db/client";

import { resolveAppVersion } from "@/server/app-version";
import { getSystemSettings } from "@/server/settings";
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

// fallow-ignore-next-line unused-export
export const getWorkerHeartbeatStatus = (
  lastSeenAt: Date | null,
  now = new Date(),
  maxAgeMs = 120_000,
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
    await assertStorageFilesystemSupported(getStorageRoot());
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

const writeWorkerHeartbeat = async (timestamp = new Date()) => {
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

// fallow-ignore-next-line unused-export
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
  storageMutations = { counts: {}, oldest: null, active: [] },
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
  storageMutations?: InstanceHealthSummary["storageMutations"];
}): InstanceHealthSummary => {
  const ok =
    databaseStatus === "healthy" &&
    storageStatus === "healthy" &&
    worker.status !== "error" &&
    queue.status !== "error" &&
    reconciliation.status !== "error";
  const storageMutationError =
    (storageMutations.counts.recovery_required ?? 0) > 0;

  return {
    ok: ok && !storageMutationError,
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
    storageMutations,
    storageWarnings,
    version: versionInfo,
  };
};

const EMPTY_STORAGE_MUTATION_HEALTH: InstanceHealthSummary["storageMutations"] =
  {
    counts: {},
    oldest: null,
    active: [],
  };

const readStorageMutationHealthProbe = async () => {
  try {
    return { health: await getStorageMutationHealth(), error: null };
  } catch (error) {
    return { health: null, error };
  }
};

const readStorageProtocolProbe = async () => {
  try {
    const instance = await getPrisma().instance.findUnique({
      where: { id: "singleton" },
      select: { storageProtocolVersion: true },
    });
    return {
      version: instance?.storageProtocolVersion ?? null,
      error: null,
    };
  } catch (error) {
    return { version: null, error };
  }
};

const storageProbeErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "unknown error";

const resolveStorageReadiness = ({
  storage,
  storageMutationProbe,
  storageProtocolProbe,
}: {
  storage: Awaited<ReturnType<typeof probeStorage>>;
  storageMutationProbe: Awaited<
    ReturnType<typeof readStorageMutationHealthProbe>
  >;
  storageProtocolProbe: Awaited<ReturnType<typeof readStorageProtocolProbe>>;
}) => {
  const storageProtocolReady =
    !storageProtocolProbe.error && storageProtocolProbe.version === 2;
  const status =
    storage.status === "healthy" &&
    !storageMutationProbe.error &&
    storageProtocolReady
      ? ("healthy" as const)
      : ("error" as const);
  if (storageMutationProbe.error) {
    return {
      status,
      message: `Storage mutation health probe failed: ${storageProbeErrorMessage(storageMutationProbe.error)}`,
    };
  }
  return {
    status,
    message: storageProtocolReady
      ? storage.message
      : "Storage protocol recovery is not complete.",
  };
};

const resolveVersionHealth = (
  instanceState: Awaited<ReturnType<typeof readInstanceUpdateCheck>> | null,
): InstanceHealthSummary["version"] => ({
  currentVersion:
    process.env.NODE_ENV !== "production" ? "development" : resolveAppVersion(),
  lastUpdateCheckAt: instanceState?.lastUpdateCheckAt?.toISOString() ?? null,
  updateCheckStatus: instanceState?.updateCheckStatus ?? null,
  updateCheckMessage: instanceState?.updateCheckMessage ?? null,
  latestAvailableVersion: instanceState?.latestAvailableVersion ?? null,
});

export const getReadiness = async () => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const [
    database,
    storage,
    heartbeat,
    queue,
    storageWarnings,
    instanceState,
    latestReconciliationRun,
    settings,
    workers,
    storageMutationProbe,
    storageProtocolProbe,
  ] = await Promise.all([
    probeDatabaseReachability(databaseUrl),
    probeStorage(),
    readWorkerHeartbeat(),
    getQueueBacklogSummary(databaseUrl),
    getStorageWarnings(),
    readInstanceUpdateCheck().catch(() => null),
    readLatestRestoreReconciliationRun().catch(() => null),
    getSystemSettings(),
    listWorkerInstances().catch(() => []),
    readStorageMutationHealthProbe(),
    readStorageProtocolProbe(),
  ]);

  const latestWorkerHeartbeat = workers[0]?.lastHeartbeatAt ?? heartbeat;
  const storageReadiness = resolveStorageReadiness({
    storage,
    storageMutationProbe,
    storageProtocolProbe,
  });

  return buildInstanceHealthSummary({
    databaseStatus: database.status,
    databaseMessage: database.message,
    storageStatus: storageReadiness.status,
    storageMessage: storageReadiness.message,
    worker: getWorkerHeartbeatStatus(
      latestWorkerHeartbeat,
      new Date(),
      settings.workerHeartbeatMaxAgeSeconds * 1000,
    ),
    queue,
    reconciliation: buildRestoreReconciliationHealthSummary(
      latestReconciliationRun,
    ),
    storageMutations:
      storageMutationProbe.health ?? EMPTY_STORAGE_MUTATION_HEALTH,
    storageWarnings,
    versionInfo: resolveVersionHealth(instanceState),
  });
};

export const getAdminHealthSummary = async () => getReadiness();

export const toJsonInstanceHealthSummary = (
  summary: InstanceHealthSummary,
): JsonInstanceHealthSummary => ({
  ...summary,
  storageMutations: {
    ...summary.storageMutations,
    oldest: summary.storageMutations.oldest
      ? {
          ...summary.storageMutations.oldest,
          createdAt: summary.storageMutations.oldest.createdAt.toISOString(),
        }
      : null,
    active: summary.storageMutations.active.map((mutation) => ({
      ...mutation,
      createdAt: mutation.createdAt.toISOString(),
    })),
  },
  storageWarnings: {
    ...summary.storageWarnings,
    freeBytes: summary.storageWarnings.freeBytes?.toString() ?? null,
    totalBytes: summary.storageWarnings.totalBytes?.toString() ?? null,
  },
});
