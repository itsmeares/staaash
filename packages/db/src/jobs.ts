import { Prisma, getPrisma } from "./client";

export const STAGING_CLEANUP_JOB_KIND = "staging.cleanup";
export const TRASH_RETENTION_JOB_KIND = "trash.retention";
export const UPDATE_CHECK_JOB_KIND = "update.check";

export const STAGING_CLEANUP_SCHEDULE_WINDOW_MS = 15 * 60 * 1000;
export const BACKGROUND_JOB_LEASE_MS = 60_000;
export const BACKGROUND_JOB_RETRY_DELAY_MS = 30_000;

export type SupportedBackgroundJobKind =
  | typeof STAGING_CLEANUP_JOB_KIND
  | typeof TRASH_RETENTION_JOB_KIND
  | typeof UPDATE_CHECK_JOB_KIND;

export const ALL_SUPPORTED_JOB_KINDS: SupportedBackgroundJobKind[] = [
  STAGING_CLEANUP_JOB_KIND,
  TRASH_RETENTION_JOB_KIND,
  UPDATE_CHECK_JOB_KIND,
];

export type BackgroundJobRecord = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  payloadJson: unknown;
  dedupeKey: string | null;
  runAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type BackgroundJobClient = {
  backgroundJob: {
    findFirst(args: object): Promise<BackgroundJobRecord | null>;
    findUnique(args: object): Promise<BackgroundJobRecord | null>;
    create(args: object): Promise<BackgroundJobRecord>;
    update(args: object): Promise<BackgroundJobRecord>;
    updateMany(args: object): Promise<{ count: number }>;
  };
  $transaction<T>(
    callback: (tx: BackgroundJobClient) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T>;
};

const BACKGROUND_JOB_SCHEDULE_MAX_RETRIES = 3;

const buildActiveStatusFilter = (now: Date) => ({
  OR: [
    {
      status: "queued",
    },
    {
      status: "running",
      lockedAt: {
        gte: new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS),
      },
    },
  ],
});

/**
 * Ensures a background job of the given kind is scheduled within the window.
 *
 * For jobs with a unique dedupeKey, pass `dedupeKey` to match an existing
 * active job by key instead of by kind+window only.
 */
export const ensureBackgroundJobScheduled = async ({
  kind,
  runAt,
  payloadJson = {},
  maxAttempts = 5,
  windowEnd = new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
  dedupeKey = null,
  now = new Date(),
  client,
}: {
  kind: SupportedBackgroundJobKind;
  runAt: Date;
  payloadJson?: Record<string, unknown>;
  maxAttempts?: number;
  windowEnd?: Date;
  dedupeKey?: string | null;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient =
    client ?? (getPrisma() as unknown as BackgroundJobClient);

  // Build the where clause — if a dedupeKey is provided, match by key+kind
  // rather than by time window.
  const dedupeFilter = dedupeKey
    ? {
        kind,
        dedupeKey,
        ...buildActiveStatusFilter(now),
      }
    : {
        kind,
        ...buildActiveStatusFilter(now),
        runAt: {
          lte: windowEnd,
        },
      };

  for (
    let attempt = 0;
    attempt < BACKGROUND_JOB_SCHEDULE_MAX_RETRIES;
    attempt += 1
  ) {
    try {
      return await activeClient.$transaction(
        async (tx) => {
          const existing = await tx.backgroundJob.findFirst({
            where: dedupeFilter,
            orderBy: {
              runAt: "asc",
            },
          });

          if (existing) {
            return {
              created: false,
              job: existing,
            };
          }

          const job = await tx.backgroundJob.create({
            data: {
              kind,
              status: "queued",
              payloadJson,
              dedupeKey,
              runAt,
              maxAttempts,
            },
          });

          return {
            created: true,
            job,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (
        attempt === BACKGROUND_JOB_SCHEDULE_MAX_RETRIES - 1 ||
        (error as { code?: string }).code !== "P2034"
      ) {
        throw error;
      }
    }
  }

  throw new Error("Failed to schedule background job.");
};

/**
 * Claims the next due background job across all supported kinds.
 * Picks the earliest-runAt job that is either queued and past its runAt,
 * or is running but has a stale lease (i.e., worker crashed mid-job).
 */
export const claimDueBackgroundJob = async ({
  workerId,
  now = new Date(),
  client,
}: {
  workerId: string;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient =
    client ?? (getPrisma() as unknown as BackgroundJobClient);

  return activeClient.$transaction(async (tx) => {
    const staleLeaseCutoff = new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS);
    const job = await tx.backgroundJob.findFirst({
      where: {
        kind: {
          in: ALL_SUPPORTED_JOB_KINDS,
        },
        OR: [
          {
            status: "queued",
            runAt: {
              lte: now,
            },
          },
          {
            status: "running",
            lockedAt: {
              lte: staleLeaseCutoff,
            },
          },
        ],
      },
      orderBy: {
        runAt: "asc",
      },
    } as object);

    if (!job) {
      return null;
    }

    const claimResult = await tx.backgroundJob.updateMany({
      where: {
        id: job.id,
        OR: [
          {
            status: "queued",
            runAt: {
              lte: now,
            },
          },
          {
            status: "running",
            lockedAt: {
              lte: staleLeaseCutoff,
            },
          },
        ],
      },
      data: {
        status: "running",
        lockedAt: now,
        lockedBy: workerId,
        attemptCount: {
          increment: 1,
        },
      },
    } as object);

    if (claimResult.count !== 1) {
      return null;
    }

    return tx.backgroundJob.findUnique({
      where: {
        id: job.id,
      },
    });
  });
};

export const markBackgroundJobSucceeded = async ({
  jobId,
  client,
}: {
  jobId: string;
  client?: BackgroundJobClient;
}) => {
  const activeClient =
    client ?? (getPrisma() as unknown as BackgroundJobClient);

  return activeClient.backgroundJob.update({
    where: {
      id: jobId,
    },
    data: {
      status: "succeeded",
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    },
  });
};

export const markBackgroundJobTerminal = async ({
  jobId,
  errorMessage,
  client,
}: {
  jobId: string;
  errorMessage: string;
  client?: BackgroundJobClient;
}) => {
  const activeClient =
    client ?? (getPrisma() as unknown as BackgroundJobClient);

  return activeClient.backgroundJob.update({
    where: {
      id: jobId,
    },
    data: {
      status: "failed",
      lockedAt: null,
      lockedBy: null,
      lastError: errorMessage,
    },
  });
};

/**
 * Marks a background job as failed. Returns the updated job record so the
 * caller can inspect whether the job transitioned to "dead" (dead-letter) or
 * back to "queued" (scheduled for retry).
 */
export const markBackgroundJobFailed = async ({
  jobId,
  errorMessage,
  now = new Date(),
  client,
}: {
  jobId: string;
  errorMessage: string;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient =
    client ?? (getPrisma() as unknown as BackgroundJobClient);

  return activeClient.$transaction(async (tx) => {
    const job = await tx.backgroundJob.findUnique({
      where: {
        id: jobId,
      },
    });

    if (!job) {
      throw new Error(`Background job ${jobId} not found.`);
    }

    const shouldDeadLetter = job.attemptCount >= job.maxAttempts;

    return tx.backgroundJob.update({
      where: {
        id: jobId,
      },
      data: {
        status: shouldDeadLetter ? "dead" : "queued",
        runAt: shouldDeadLetter
          ? job.runAt
          : new Date(now.getTime() + BACKGROUND_JOB_RETRY_DELAY_MS),
        lockedAt: null,
        lockedBy: null,
        lastError: errorMessage,
      },
    });
  });
};
