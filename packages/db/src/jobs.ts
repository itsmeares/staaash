import { prisma } from "./client";

export const STAGING_CLEANUP_JOB_KIND = "staging.cleanup";
export const STAGING_CLEANUP_SCHEDULE_WINDOW_MS = 15 * 60 * 1000;

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
    create(args: object): Promise<BackgroundJobRecord>;
    update(args: object): Promise<BackgroundJobRecord>;
  };
  $transaction<T>(callback: (tx: BackgroundJobClient) => Promise<T>): Promise<T>;
};

const activeStatuses = ["queued", "running"] as const;

export const ensureBackgroundJobScheduled = async ({
  kind,
  runAt,
  payloadJson = {},
  maxAttempts = 5,
  windowEnd = new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
  client = prisma as unknown as BackgroundJobClient,
}: {
  kind: SupportedBackgroundJobKind;
  runAt: Date;
  payloadJson?: Record<string, unknown>;
  maxAttempts?: number;
  windowEnd?: Date;
  client?: BackgroundJobClient;
}) => {
  const existing = await client.backgroundJob.findFirst({
    where: {
      kind,
      status: {
        in: activeStatuses,
      },
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
    const job = await tx.backgroundJob.findFirst({
      where: {
        kind,
        status: "queued",
        runAt: {
          lte: now,
        },
      },
      orderBy: {
        runAt: "asc",
      },
    });

    if (!job) {
      return null;
    }

    return tx.backgroundJob.update({
      where: {
        id: job.id,
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
  client = prisma as unknown as BackgroundJobClient,
}: {
  jobId: string;
  errorMessage: string;
  client?: BackgroundJobClient;
}) =>
  client.backgroundJob.update({
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
