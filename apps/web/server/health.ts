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
import { deriveEffectiveUpdateStatus } from "@/server/update-derive";
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

const operationalStatus = (
  failures: string[],
  incidents: string[],
): HealthCheckStatus => {
  if (failures.length > 0) return "error";
  return incidents.length > 0 ? "warning" : "healthy";
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
  settingsStatus = "healthy",
  settingsMessage,
  storageMutationStatus,
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
  settingsStatus?: HealthCheckStatus;
  settingsMessage?: string;
  storageMutationStatus?: HealthCheckStatus;
}): InstanceHealthSummary => {
  const recoveryRequired = (storageMutations.counts.recovery_required ?? 0) > 0;
  const mutationStatus = recoveryRequired
    ? "error"
    : (storageMutationStatus ?? "healthy");
  const unavailableChecks = {
    DATABASE_UNAVAILABLE: databaseStatus,
    STORAGE_UNAVAILABLE: storageStatus,
    SETTINGS_UNAVAILABLE: settingsStatus,
    QUEUE_PROBE_UNAVAILABLE: queue.probeStatus,
  };
  const failedChecks = {
    [settingsStatus !== "healthy"
      ? "WORKER_SETTINGS_UNAVAILABLE"
      : "WORKER_UNHEALTHY"]: worker.status,
    RESTORE_RECONCILIATION_FAILED: reconciliation.status,
    [recoveryRequired
      ? "STORAGE_RECOVERY_REQUIRED"
      : "STORAGE_MUTATION_HEALTH_UNAVAILABLE"]: mutationStatus,
  };
  const failures = [
    ...Object.entries(unavailableChecks).filter(
      ([, status]) => status !== "healthy",
    ),
    ...Object.entries(failedChecks).filter(([, status]) => status === "error"),
  ].map(([code]) => code);

  const incidentChecks = {
    DEAD_JOBS: queue.dead > 0,
    FAILED_JOBS: queue.failed > 0,
    STALE_JOBS: queue.staleRunning > 0,
    WORKER_WARNING: worker.status === "warning",
    RECONCILIATION_WARNING: reconciliation.status === "warning",
    STORAGE_WARNING: storageWarnings.status !== "healthy",
  };
  const incidents = [
    ...failures,
    ...Object.entries(incidentChecks)
      .filter(([, active]) => active)
      .map(([code]) => code),
  ];

  return {
    ok: failures.length === 0,
    operational: {
      status: operationalStatus(failures, incidents),
      incidents,
    },
    failures,
    checks: {
      app: {
        status: "healthy",
      },
      queue: { status: queue.probeStatus },
      database: {
        status: databaseStatus,
        message: databaseMessage,
      },
      storage: {
        status: storageStatus,
        message: storageMessage,
      },
      settings: {
        status: settingsStatus,
        message: settingsMessage,
      },
      storageMutations: {
        status: mutationStatus,
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
    storageMutationProbe.health !== null &&
    storageProtocolReady
      ? ("healthy" as const)
      : ("error" as const);
  if (storageMutationProbe.health === null) {
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

// fallow-ignore-next-line unused-export
export const resolveVersionHealth = (
  instanceState: Awaited<ReturnType<typeof readInstanceUpdateCheck>> | null,
): InstanceHealthSummary["version"] => {
  const currentVersion = resolveAppVersion();

  const { updateCheckStatus, updateCheckMessage, latestAvailableVersion } =
    deriveEffectiveUpdateStatus({
      currentVersion,
      persisted: {
        updateCheckStatus: instanceState?.updateCheckStatus ?? null,
        updateCheckMessage: instanceState?.updateCheckMessage ?? null,
        latestAvailableVersion: instanceState?.latestAvailableVersion ?? null,
        checkedVersion: instanceState?.checkedVersion ?? null,
      },
    });

  return {
    currentVersion,
    lastUpdateCheckAt: instanceState?.lastUpdateCheckAt?.toISOString() ?? null,
    updateCheckStatus,
    updateCheckMessage,
    latestAvailableVersion,
  };
};

const resolveSettingsReadiness = (
  probe: {
    settings: Awaited<ReturnType<typeof getSystemSettings>> | null;
    error: unknown;
  },
  latestWorkerHeartbeat: Date | null,
): {
  settings: InstanceHealthSummary["checks"]["settings"];
  worker: WorkerHeartbeatStatus;
} => {
  if (probe.settings) {
    return {
      settings: { status: "healthy" },
      worker: getWorkerHeartbeatStatus(
        latestWorkerHeartbeat,
        new Date(),
        probe.settings.workerHeartbeatMaxAgeSeconds * 1000,
      ),
    };
  }
  return {
    settings: {
      status: "error",
      message: `Settings health probe failed: ${storageProbeErrorMessage(probe.error)}`,
    },
    worker: {
      status: "error",
      lastSeenAt: latestWorkerHeartbeat?.toISOString() ?? null,
      message: "Worker heartbeat settings are unavailable.",
    },
  };
};

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
    settingsProbe,
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
    getSystemSettings()
      .then((settings) => ({ settings, error: null }))
      .catch((error: unknown) => ({ settings: null, error })),
    listWorkerInstances().catch(() => []),
    readStorageMutationHealthProbe(),
    readStorageProtocolProbe(),
  ]);

  const latestWorkerHeartbeat = workers[0]?.lastHeartbeatAt ?? heartbeat;
  const settingsReadiness = resolveSettingsReadiness(
    settingsProbe,
    latestWorkerHeartbeat,
  );
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
    settingsStatus: settingsReadiness.settings.status,
    settingsMessage: settingsReadiness.settings.message,
    worker: settingsReadiness.worker,
    queue,
    reconciliation: buildRestoreReconciliationHealthSummary(
      latestReconciliationRun,
    ),
    storageMutations:
      storageMutationProbe.health ?? EMPTY_STORAGE_MUTATION_HEALTH,
    storageMutationStatus: storageMutationProbe.health ? undefined : "error",
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
