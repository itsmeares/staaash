import type { StorageMutationStatus } from "@staaash/db/storage-mutations";

export type UserRole = "owner" | "admin" | "member";

export type SearchMatchKind = "exact" | "prefix" | "substring";

export type HealthCheckStatus = "healthy" | "warning" | "error";

export type SearchNormalizationPolicy = {
  caseInsensitive: true;
  accentInsensitive: true;
  tokenizedPathMatching: true;
};

export type SearchResultItem = {
  id: string;
  name: string;
  path: string;
  updatedAt: Date;
  matchKind: SearchMatchKind;
};

export type WorkerHeartbeatStatus = {
  status: HealthCheckStatus;
  lastSeenAt: string | null;
  message: string;
};

export type StorageWarningSummary = {
  status: HealthCheckStatus;
  freeBytes: bigint | null;
  totalBytes: bigint | null;
  message: string;
};

export type RestoreReconciliationReport = {
  missingOriginalIds: string[];
  orphanedStorageKeys: string[];
};

export type RestoreReconciliationRunStatus =
  "queued" | "running" | "succeeded" | "failed";

export type RestoreReconciliationHealthSummary = {
  status: HealthCheckStatus;
  runStatus: RestoreReconciliationRunStatus | null;
  lastCompletedAt: string | null;
  missingOriginalCount: number;
  orphanedStorageCount: number;
  message: string;
};

export type QueueBacklogSummary = {
  queued: number;
  running: number;
  failed: number;
  dead: number;
  cancelled: number;
  oldestQueuedAgeSeconds: number | null;
  staleRunning: number;
  status: HealthCheckStatus;
  message?: string;
};

export type InstanceHealthSummary = {
  ok: boolean;
  checks: {
    app: {
      status: HealthCheckStatus;
    };
    database: {
      status: HealthCheckStatus;
      message?: string;
    };
    storage: {
      status: HealthCheckStatus;
      message?: string;
    };
  };
  worker: WorkerHeartbeatStatus;
  queue: QueueBacklogSummary;
  reconciliation: RestoreReconciliationHealthSummary;
  storageMutations: {
    counts: Record<string, number>;
    oldest: {
      id: string;
      kind: string;
      status: StorageMutationStatus;
      ownerUserId: string;
      createdAt: Date;
      ageMs: number;
    } | null;
    active: Array<{
      id: string;
      kind: string;
      status: StorageMutationStatus;
      ownerUserId: string;
      createdAt: Date;
      ageMs: number;
      lastError: string | null;
      canRetryNow: boolean;
      safePathLabels: string[];
    }>;
  };
  storageWarnings: StorageWarningSummary;
  version: {
    currentVersion: string;
    lastUpdateCheckAt: string | null;
    updateCheckStatus:
      "up-to-date" | "update-available" | "unavailable" | "error" | null;
    updateCheckMessage: string | null;
    latestAvailableVersion: string | null;
  };
};

export type JsonStorageWarningSummary = Omit<
  StorageWarningSummary,
  "freeBytes" | "totalBytes"
> & {
  freeBytes: string | null;
  totalBytes: string | null;
};

export type JsonInstanceHealthSummary = Omit<
  InstanceHealthSummary,
  "storageWarnings" | "storageMutations"
> & {
  storageWarnings: JsonStorageWarningSummary;
  storageMutations: Omit<
    InstanceHealthSummary["storageMutations"],
    "oldest" | "active"
  > & {
    oldest:
      | (Omit<
          NonNullable<InstanceHealthSummary["storageMutations"]["oldest"]>,
          "createdAt"
        > & { createdAt: string })
      | null;
    active: Array<
      Omit<
        InstanceHealthSummary["storageMutations"]["active"][number],
        "createdAt"
      > & { createdAt: string }
    >;
  };
};
