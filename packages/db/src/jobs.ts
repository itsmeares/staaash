import { prisma } from "./client";

export const STAGING_CLEANUP_JOB_KIND = "staging.cleanup";
export const STAGING_CLEANUP_SCHEDULE_WINDOW_MS = 15 * 60 * 1000;
export const BACKGROUND_JOB_LEASE_MS = 60_000;
export const BACKGROUND_JOB_RETRY_DELAY_MS = 30_000;

export type SupportedBackgroundJobKind = typeof STAGING_CLEANUP_JOB_KIND;

export type BackgroundJobRecord = {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "dead";
  payloadJson: unknown;
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
  $transaction<T>(callback: (tx: BackgroundJobClient) => Promise<T>): Promise<T>;
};

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

export const ensureBackgroundJobScheduled = async ({
  kind,
  runAt,
  payloadJson = {},
  maxAttempts = 5,
  windowEnd = new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
  now = new Date(),
  client = prisma as unknown as BackgroundJobClient,
}: {
  kind: SupportedBackgroundJobKind;
  runAt: Date;
  payloadJson?: Record<string, unknown>;
  maxAttempts?: number;
  windowEnd?: Date;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const existing = await client.backgroundJob.findFirst({
    where: {
      kind,
      ...buildActiveStatusFilter(now),
      runAt: {
        lte: windowEnd,
      },
    },
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

  const job = await client.backgroundJob.create({
    data: {
      kind,
      status: "queued",
      payloadJson,
      runAt,
      maxAttempts,
    },
  });

  return {
    created: true,
    job,
  };
};

export const claimDueBackgroundJob = async ({
  kind,
  workerId,
  now = new Date(),
  client = prisma as unknown as BackgroundJobClient,
}: {
  kind: SupportedBackgroundJobKind;
  workerId: string;
  now?: Date;
  client?: BackgroundJobClient;
}) =>
  client.$transaction(async (tx) => {
    const staleLeaseCutoff = new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS);
    const job = await tx.backgroundJob.findFirst({
      where: {
        kind,
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
    });

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
    });

    if (claimResult.count !== 1) {
      return null;
    }

    return tx.backgroundJob.findUnique({
      where: {
        id: job.id,
      },
    });
  });

export const markBackgroundJobSucceeded = async ({
  jobId,
  client = prisma as unknown as BackgroundJobClient,
}: {
  jobId: string;
  client?: BackgroundJobClient;
}) =>
  client.backgroundJob.update({
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

export const markBackgroundJobFailed = async ({
  jobId,
  errorMessage,
  now = new Date(),
  client = prisma as unknown as BackgroundJobClient,
}: {
  jobId: string;
  errorMessage: string;
  now?: Date;
  client?: BackgroundJobClient;
}) =>
  client.$transaction(async (tx) => {
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
