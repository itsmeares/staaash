export type UserRole = "owner" | "member";

export type UploadConflictStrategy = "fail" | "safeRename" | "replace";

export type UploadCommitStatus = "staged" | "verified" | "committed" | "failed";

export type SearchMatchKind = "exact" | "prefix" | "substring";

export type HealthCheckStatus = "healthy" | "warning" | "error";

export type UploadSession = {
  id: string;
  tmpPath: string;
  conflictStrategy: UploadConflictStrategy;
  status: UploadCommitStatus;
  expectedChecksum?: string;
};

export type UploadVerificationResult = {
  status: UploadCommitStatus;
  checksumMatches: boolean;
  actualChecksum: string;
  expectedChecksum?: string;
};

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
  previewRegenerationIds: string[];
  orphanedStorageKeys: string[];
};

export type QueueBacklogSummary = {
  queued: number;
  running: number;
  failed: number;
  dead: number;
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
  storageWarnings: StorageWarningSummary;
  version: {
    currentVersion: string;
    lastUpdateCheckAt: string | null;
    updateCheckStatus: string | null;
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
  "storageWarnings"
> & {
  storageWarnings: JsonStorageWarningSummary;
};
