import { Prisma, getPrisma } from "./client";
import {
  acquireStorageMutationResources,
  lockStorageMutationAdmission,
  storagePathResourceKey,
} from "./storage-mutations";
import {
  runStorageTransaction,
  waitForStorageAdmission,
} from "./storage-transactions";

export type ReconciledFile = {
  id: string;
  ownerUserId: string;
  storageKey: string;
  storageRevision: number;
};

export const readReconciliationOrphanState = async (keys: string[]) =>
  waitForStorageAdmission((deadline) =>
    runStorageTransaction(
      async (tx) => {
        await lockStorageMutationAdmission(tx, true);
        // An admitted mutation can finish here, so read its paths before current metadata.
        const [steps, sessions, jobs] = await Promise.all([
          tx.storageMutationStep.findMany({
            where: {
              mutation: {
                status: {
                  in: [
                    "prepared",
                    "running",
                    "retrying",
                    "metadata_committed",
                    "finalizing",
                    "recovery_required",
                  ],
                },
              },
            },
            select: {
              action: true,
              expectedNodeType: true,
              sourceKey: true,
              targetKey: true,
            },
          }),
          tx.uploadSession.findMany({
            where: {
              stagingReleasedAt: null,
              status: {
                in: ["allocating", "created", "receiving", "committing"],
              },
            },
            select: { tmpPath: true },
          }),
          tx.backgroundJob.findMany({
            where: {
              kind: {
                in: ["media.derivative.generate", "zip.archive.generate"],
              },
              status: { in: ["queued", "running"] },
            },
            select: { kind: true, dedupeKey: true },
          }),
        ]);
        const derivativeIds = keys.flatMap((key) => {
          const match = /^tmp\/derivatives\/([^/]+)\.(?:jpg|mp4)\.tmp$/.exec(
            key,
          );
          return match ? [match[1]!] : [];
        });
        const [files, derivatives, archives] = await Promise.all([
          tx.file.findMany({
            where: { storageKey: { in: keys } },
            select: { storageKey: true },
          }),
          tx.mediaDerivative.findMany({
            where: {
              OR: [{ storageKey: { in: keys } }, { id: { in: derivativeIds } }],
            },
            select: {
              id: true,
              fileId: true,
              kind: true,
              profile: true,
              storageKey: true,
            },
          }),
          tx.zipArchive.findMany({
            where: { storageKey: { in: keys } },
            select: { storageKey: true },
          }),
        ]);
        return { steps, sessions, jobs, files, derivatives, archives };
      },
      { deadline },
    ),
  );

export const saveReconciledFileStatuses = async ({
  files,
  missingIds,
  checkedAt,
}: {
  files: ReconciledFile[];
  missingIds: string[];
  checkedAt: Date;
}) => {
  const missing = new Set(missingIds);
  const owners = new Map<string, ReconciledFile[]>();
  for (const file of files) {
    const group = owners.get(file.ownerUserId) ?? [];
    group.push(file);
    owners.set(file.ownerUserId, group);
  }
  for (const [ownerUserId, group] of owners) {
    for (let offset = 0; offset < group.length; offset += 500) {
      const batch = group.slice(offset, offset + 500);
      await waitForStorageAdmission(
        (deadline) =>
          runStorageTransaction(
            async (tx) => {
              // Hold admission until the checked revision and status write agree.
              await acquireStorageMutationResources(
                tx,
                batch.map((file) =>
                  storagePathResourceKey(ownerUserId, file.storageKey),
                ),
              );
              const current = await tx.file.findMany({
                where: { id: { in: batch.map((file) => file.id) } },
                select: {
                  id: true,
                  ownerUserId: true,
                  storageKey: true,
                  storageRevision: true,
                },
              });
              const byId = new Map(current.map((file) => [file.id, file]));
              if (
                batch.some((file) => {
                  const row = byId.get(file.id);
                  return (
                    !row ||
                    row.ownerUserId !== file.ownerUserId ||
                    row.storageKey !== file.storageKey ||
                    row.storageRevision !== file.storageRevision
                  );
                })
              ) {
                throw new Error("Files changed during the restore check.");
              }
              const available = batch
                .filter((file) => !missing.has(file.id))
                .map((file) => file.id);
              const absent = batch
                .filter((file) => missing.has(file.id))
                .map((file) => file.id);
              if (available.length)
                await tx.file.updateMany({
                  where: { id: { in: available } },
                  data: {
                    storageStatus: "available",
                    storageCheckedAt: checkedAt,
                    storageMissingAt: null,
                  },
                });
              if (absent.length)
                await tx.file.updateMany({
                  where: { id: { in: absent } },
                  data: {
                    storageStatus: "missing",
                    storageCheckedAt: checkedAt,
                    storageMissingAt: checkedAt,
                  },
                });
            },
            { deadline },
          ),
        { ownerUserId },
      );
    }
  }
};

export const rebuildFolderSizeTotals = async () => {
  await getPrisma().$queryRaw`
    SELECT staaash_rebuild_folder_sizes(array_agg(id))::text FROM "Folder"
  `;
};

export const verifyCommittedStorageUsage = async () => {
  const client = getPrisma();
  const mismatches = await client.$queryRaw<Array<{ id: string }>>`
    SELECT u.id FROM "User" u
    LEFT JOIN (
      SELECT "ownerUserId", SUM("sizeBytes") AS bytes
      FROM "File" GROUP BY "ownerUserId"
    ) totals ON totals."ownerUserId" = u.id
    WHERE u."committedStorageBytes" IS DISTINCT FROM COALESCE(totals.bytes, 0)
  `;
  if (mismatches.length === 0) return;
  await client.user.updateMany({
    where: { id: { in: mismatches.map(({ id }) => id) } },
    data: { committedStorageBytes: null },
  });
  throw new Error(
    "Committed storage usage does not match file metadata. A startup audit failure prevents web and worker startup for the entire instance, even if only one account is affected. A restore audit failure stops reconciliation. Affected totals remain unavailable. Stop all writers, investigate the mismatch, and rebuild usage before restarting.",
  );
};

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
  uncheckedOriginalCount?: number;
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
    uncheckedOriginalCount?: unknown;
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
  if (
    typeof candidate.uncheckedOriginalCount === "number" &&
    Number.isSafeInteger(candidate.uncheckedOriginalCount) &&
    candidate.uncheckedOriginalCount > 0
  ) {
    details.uncheckedOriginalCount = candidate.uncheckedOriginalCount;
  }
  return details;
};

const toRunRecord = (
  record: RestoreReconciliationRunRow,
): RestoreReconciliationRunRecord => ({
  ...record,
  details: normalizeDetails(record.detailsJson),
});

export const ensureRestoreReconciliationRun = async (
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

  try {
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
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    )
      throw error;
    // The worker can create this row before the scheduling request does.
    const existing = await activeClient.restoreReconciliationRun.findUnique({
      where: { backgroundJobId },
    });
    if (!existing) throw error;
    return toRunRecord(existing);
  }
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
