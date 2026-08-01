import { getPrisma } from "./client";

export type RestoreReconciliationStatus =
  "queued" | "running" | "succeeded" | "failed";

export type RestoreReconciliationMissingOriginal = {
  fileId: string;
  storageKey: string;
};

export type RestoreReconciliationIssueDetails = {
  missingOriginals: RestoreReconciliationMissingOriginal[];
  orphanedStorageKeys: string[];
  mutationTrackedStorageKeys?: string[];
  recoveryRequiredMutations?: Array<{
    id: string;
    kind: string;
  }>;
  checksumMismatches?: Array<{
    fileId: string;
    storageKey: string;
  }>;
};

export type RestoreReconciliationRunRecord = {
  id: string;
  status: RestoreReconciliationStatus;
  triggeredByUserId: string | null;
  backgroundJobId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  missingOriginalCount: number;
  orphanedStorageCount: number;
  details: RestoreReconciliationIssueDetails;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RestoreReconciliationRunRow = Omit<
  RestoreReconciliationRunRecord,
  "details"
> & {
  detailsJson: unknown;
};

type RestoreReconciliationClient = {
  restoreReconciliationRun: {
    findUnique(args: object): Promise<RestoreReconciliationRunRow | null>;
    findFirst(args: object): Promise<RestoreReconciliationRunRow | null>;
    findMany(args: object): Promise<RestoreReconciliationRunRow[]>;
    create(args: object): Promise<RestoreReconciliationRunRow>;
    update(args: object): Promise<RestoreReconciliationRunRow>;
  };
};

const emptyDetails = (): RestoreReconciliationIssueDetails => ({
  missingOriginals: [],
  orphanedStorageKeys: [],
});

const stringsFrom = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const missingOriginalsFrom = (
  value: unknown,
): RestoreReconciliationMissingOriginal[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return typeof row.fileId === "string" &&
          typeof row.storageKey === "string"
          ? [{ fileId: row.fileId, storageKey: row.storageKey }]
          : [];
      })
    : [];

const recoveryMutationsFrom = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        return typeof row.id === "string" && typeof row.kind === "string"
          ? [{ id: row.id, kind: row.kind }]
          : [];
      })
    : [];

const normalizeDetails = (
  value: unknown,
): RestoreReconciliationIssueDetails => {
  if (!value || typeof value !== "object") {
    return emptyDetails();
  }

  const candidate = value as {
    missingOriginals?: unknown;
    orphanedStorageKeys?: unknown;
    mutationTrackedStorageKeys?: unknown;
    recoveryRequiredMutations?: unknown;
    checksumMismatches?: unknown;
  };

  const details: RestoreReconciliationIssueDetails = {
    missingOriginals: missingOriginalsFrom(candidate.missingOriginals),
    orphanedStorageKeys: stringsFrom(candidate.orphanedStorageKeys),
  };
  if (Array.isArray(candidate.mutationTrackedStorageKeys)) {
    details.mutationTrackedStorageKeys = stringsFrom(
      candidate.mutationTrackedStorageKeys,
    );
  }
  if (Array.isArray(candidate.recoveryRequiredMutations)) {
    details.recoveryRequiredMutations = recoveryMutationsFrom(
      candidate.recoveryRequiredMutations,
    );
  }
  if (Array.isArray(candidate.checksumMismatches)) {
    details.checksumMismatches = missingOriginalsFrom(
      candidate.checksumMismatches,
    );
  }
  return details;
};

const toRunRecord = (
  record: RestoreReconciliationRunRow,
): RestoreReconciliationRunRecord => ({
  ...record,
  details: normalizeDetails(record.detailsJson),
});

export const createRestoreReconciliationRun = async (
  {
    triggeredByUserId,
    backgroundJobId,
  }: {
    triggeredByUserId: string | null;
    backgroundJobId: string;
  },
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  return toRunRecord(
    await activeClient.restoreReconciliationRun.create({
      data: {
        status: "queued",
        triggeredByUserId,
        backgroundJobId,
        detailsJson: emptyDetails(),
      },
    }),
  );
};

export const findRestoreReconciliationRunByBackgroundJobId = async (
  backgroundJobId: string,
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord | null> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  const record = await activeClient.restoreReconciliationRun.findUnique({
    where: {
      backgroundJobId,
    },
  });

  return record ? toRunRecord(record) : null;
};

export const readLatestRestoreReconciliationRun = async (
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord | null> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  const record = await activeClient.restoreReconciliationRun.findFirst({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  return record ? toRunRecord(record) : null;
};

export const listRecentRestoreReconciliationRuns = async (
  {
    limit = 5,
  }: {
    limit?: number;
  } = {},
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord[]> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  return (
    await activeClient.restoreReconciliationRun.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.max(1, Math.min(limit, 20)),
    })
  ).map(toRunRecord);
};

export const markRestoreReconciliationRunRunning = async (
  {
    backgroundJobId,
    startedAt = new Date(),
  }: {
    backgroundJobId: string;
    startedAt?: Date;
  },
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  return toRunRecord(
    await activeClient.restoreReconciliationRun.update({
      where: {
        backgroundJobId,
      },
      data: {
        status: "running",
        startedAt,
        completedAt: null,
        lastError: null,
      },
    }),
  );
};

export const markRestoreReconciliationRunQueued = async (
  {
    backgroundJobId,
    errorMessage,
  }: {
    backgroundJobId: string;
    errorMessage: string;
  },
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  return toRunRecord(
    await activeClient.restoreReconciliationRun.update({
      where: {
        backgroundJobId,
      },
      data: {
        status: "queued",
        completedAt: null,
        lastError: errorMessage,
      },
    }),
  );
};

export const completeRestoreReconciliationRun = async (
  {
    backgroundJobId,
    details,
    completedAt = new Date(),
  }: {
    backgroundJobId: string;
    details: RestoreReconciliationIssueDetails;
    completedAt?: Date;
  },
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  return toRunRecord(
    await activeClient.restoreReconciliationRun.update({
      where: {
        backgroundJobId,
      },
      data: {
        status: "succeeded",
        completedAt,
        missingOriginalCount: details.missingOriginals.length,
        orphanedStorageCount: details.orphanedStorageKeys.length,
        detailsJson: details,
        lastError: null,
      },
    }),
  );
};

export const failRestoreReconciliationRun = async (
  {
    backgroundJobId,
    errorMessage,
    completedAt = new Date(),
  }: {
    backgroundJobId: string;
    errorMessage: string;
    completedAt?: Date;
  },
  client?: RestoreReconciliationClient,
): Promise<RestoreReconciliationRunRecord> => {
  const activeClient =
    client ?? (getPrisma() as unknown as RestoreReconciliationClient);

  return toRunRecord(
    await activeClient.restoreReconciliationRun.update({
      where: {
        backgroundJobId,
      },
      data: {
        status: "failed",
        completedAt,
        lastError: errorMessage,
      },
    }),
  );
};
