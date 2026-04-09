import type {
  AdminBackgroundJobListResult as DbAdminBackgroundJobListResult,
  AdminStorageUsageSummary as DbAdminStorageUsageSummary,
  AdminUserStorageRow as DbAdminUserStorageRow,
} from "@staaash/db/admin";
import type { UpdateCheckStatus } from "@staaash/db/instance";

import type {
  InstanceHealthSummary,
  QueueBacklogSummary,
  RestoreReconciliationHealthSummary,
} from "@/server/types";
import type {
  RestoreReconciliationIssueDetails,
  RestoreReconciliationRunRecord as DbRestoreReconciliationRunRecord,
} from "@staaash/db/reconciliation";

export type AdminUserStorageRow = DbAdminUserStorageRow;

export type AdminStorageSummary = DbAdminStorageUsageSummary;

export type AdminJobListResponse = DbAdminBackgroundJobListResult;

export type AdminUpdateStatus = {
  currentVersion: string;
  repository: string | null;
  lastUpdateCheckAt: Date | null;
  updateCheckStatus: UpdateCheckStatus | null;
  updateCheckMessage: string | null;
  latestAvailableVersion: string | null;
};

export type AdminRestoreReconciliationRun = DbRestoreReconciliationRunRecord;

export type AdminIntegritySummary = {
  health: RestoreReconciliationHealthSummary;
  latestRun: AdminRestoreReconciliationRun | null;
  recentRuns: AdminRestoreReconciliationRun[];
  hasActiveRun: boolean;
};

export type AdminOverviewSummary = {
  health: InstanceHealthSummary;
  storage: Pick<
    AdminStorageSummary,
    "totalUsers" | "retainedFileCount" | "retainedFolderCount" | "retainedBytes"
  >;
  jobs: QueueBacklogSummary & {
    total: number;
  };
  users: {
    total: number;
    owners: number;
    members: number;
    activeInvites: number;
  };
  updates: AdminUpdateStatus;
};

export type JsonAdminUserStorageRow = Omit<
  AdminUserStorageRow,
  "retainedBytes" | "createdAt" | "lastContentActivityAt"
> & {
  retainedBytes: string;
  createdAt: string;
  lastContentActivityAt: string | null;
};

export type JsonAdminStorageSummary = Omit<
  AdminStorageSummary,
  "retainedBytes" | "rows"
> & {
  retainedBytes: string;
  rows: JsonAdminUserStorageRow[];
};

export type JsonAdminJobListResponse = Omit<AdminJobListResponse, "items"> & {
  items: Array<
    Omit<
      AdminJobListResponse["items"][number],
      "runAt" | "lockedAt" | "createdAt" | "updatedAt"
    > & {
      runAt: string;
      lockedAt: string | null;
      createdAt: string;
      updatedAt: string;
    }
  >;
};

export type JsonAdminUpdateStatus = Omit<
  AdminUpdateStatus,
  "lastUpdateCheckAt"
> & {
  lastUpdateCheckAt: string | null;
};

export type JsonRestoreReconciliationIssueDetails =
  RestoreReconciliationIssueDetails;

export type JsonAdminRestoreReconciliationRun = Omit<
  AdminRestoreReconciliationRun,
  "startedAt" | "completedAt" | "createdAt" | "updatedAt" | "details"
> & {
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  details: JsonRestoreReconciliationIssueDetails;
};

export type JsonAdminIntegritySummary = Omit<
  AdminIntegritySummary,
  "latestRun" | "recentRuns"
> & {
  latestRun: JsonAdminRestoreReconciliationRun | null;
  recentRuns: JsonAdminRestoreReconciliationRun[];
};
