import { getPrisma } from "./client";

export type RestoreReconciliationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type RestoreReconciliationMissingOriginal = {
  fileId: string;
  storageKey: string;
};

export type RestoreReconciliationIssueDetails = {
  missingOriginals: RestoreReconciliationMissingOriginal[];
  orphanedStorageKeys: string[];
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

const normalizeDetails = (
  value: unknown,
): RestoreReconciliationIssueDetails => {
  if (!value || typeof value !== "object") {
    return emptyDetails();
  }

  const candidate = value as {
    missingOriginals?: unknown;
    orphanedStorageKeys?: unknown;
  };

  return {
    missingOriginals: Array.isArray(candidate.missingOriginals)
      ? candidate.missingOriginals.flatMap((item) => {
          if (!item || typeof item !== "object") {
            return [];
          }

          const missingOriginal = item as {
            fileId?: unknown;
            storageKey?: unknown;
          };

          if (
            typeof missingOriginal.fileId !== "string" ||
            typeof missingOriginal.storageKey !== "string"
          ) {
            return [];
          }

          return [
            {
              fileId: missingOriginal.fileId,
              storageKey: missingOriginal.storageKey,
            },
          ];
        })
      : [],
    orphanedStorageKeys: Array.isArray(candidate.orphanedStorageKeys)
      ? candidate.orphanedStorageKeys.filter(
          (item): item is string => typeof item === "string",
        )
      : [],
  };
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
