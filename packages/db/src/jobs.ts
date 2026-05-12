import { Prisma, getPrisma } from "./client";

export const STAGING_CLEANUP_JOB_KIND = "staging.cleanup";
export const TRASH_RETENTION_JOB_KIND = "trash.retention";
export const UPDATE_CHECK_JOB_KIND = "update.check";
export const RESTORE_RECONCILE_JOB_KIND = "restore.reconcile";
export const MEDIA_DERIVATIVE_GENERATE_JOB_KIND = "media.derivative.generate";
export const MEDIA_DERIVATIVE_CLEANUP_JOB_KIND = "media.derivative.cleanup";
export const ZIP_ARCHIVE_GENERATE_JOB_KIND = "zip.archive.generate" as const;
export const ZIP_ARCHIVE_CLEANUP_JOB_KIND = "zip.archive.cleanup" as const;

export const DEFAULT_BACKGROUND_JOB_QUEUE = "default";
export const STAGING_CLEANUP_SCHEDULE_WINDOW_MS = 15 * 60 * 1000;
export const BACKGROUND_JOB_LEASE_MS = 60_000;
export const BACKGROUND_JOB_RETRY_DELAY_MS = 30_000;
export const BACKGROUND_JOB_RETRY_DELAY_MAX_MS = 15 * 60 * 1000;

export type SupportedBackgroundJobKind =
  | typeof STAGING_CLEANUP_JOB_KIND
  | typeof TRASH_RETENTION_JOB_KIND
  | typeof UPDATE_CHECK_JOB_KIND
  | typeof RESTORE_RECONCILE_JOB_KIND
  | typeof MEDIA_DERIVATIVE_GENERATE_JOB_KIND
  | typeof MEDIA_DERIVATIVE_CLEANUP_JOB_KIND
  | typeof ZIP_ARCHIVE_GENERATE_JOB_KIND
  | typeof ZIP_ARCHIVE_CLEANUP_JOB_KIND;

export const ALL_SUPPORTED_JOB_KINDS: SupportedBackgroundJobKind[] = [
  STAGING_CLEANUP_JOB_KIND,
  TRASH_RETENTION_JOB_KIND,
  UPDATE_CHECK_JOB_KIND,
  RESTORE_RECONCILE_JOB_KIND,
  MEDIA_DERIVATIVE_GENERATE_JOB_KIND,
  MEDIA_DERIVATIVE_CLEANUP_JOB_KIND,
  ZIP_ARCHIVE_GENERATE_JOB_KIND,
  ZIP_ARCHIVE_CLEANUP_JOB_KIND,
];

export type BackgroundJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "dead"
  | "cancelled";

export type BackgroundJobRecord = {
  id: string;
  kind: string;
  queueName?: string;
  priority?: number;
  status: BackgroundJobStatus;
  payloadJson: unknown;
  progressJson?: unknown;
  dedupeKey: string | null;
  runAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  leaseExpiresAt?: Date | null;
  timeoutAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledByUserId?: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  errorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BackgroundJobEventRecord = {
  id: string;
  jobId: string;
  type: string;
  message: string | null;
  metadataJson: unknown;
  workerId: string | null;
  createdAt: Date;
};

export type WorkerInstanceRecord = {
  id: string;
  hostname: string;
  pid: number;
  version: string | null;
  startedAt: Date;
  lastHeartbeatAt: Date;
  stoppedAt: Date | null;
  status: string;
  currentJobId: string | null;
  metadataJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type BackgroundJobStatusGroup = {
  status: BackgroundJobStatus;
  _count: { status: number };
};

type BackgroundJobKindStatusGroup = {
  kind: string;
  status: BackgroundJobStatus;
  _count: { status: number };
};

type BackgroundJobClient = {
  backgroundJob: {
    findFirst(args: object): Promise<BackgroundJobRecord | null>;
    findUnique(args: object): Promise<BackgroundJobRecord | null>;
    findMany(args: object): Promise<BackgroundJobRecord[]>;
    create(args: object): Promise<BackgroundJobRecord>;
    update(args: object): Promise<BackgroundJobRecord>;
    updateMany(args: object): Promise<{ count: number }>;
    count(args?: object): Promise<number>;
    groupBy(args: object): Promise<BackgroundJobStatusGroup[]>;
  };
  backgroundJobEvent: {
    create(args: object): Promise<BackgroundJobEventRecord>;
    findMany(args: object): Promise<BackgroundJobEventRecord[]>;
  };
  workerInstance: {
    upsert(args: object): Promise<WorkerInstanceRecord>;
    update(args: object): Promise<WorkerInstanceRecord>;
    findMany(args: object): Promise<WorkerInstanceRecord[]>;
  };
  $transaction<T>(
    callback: (tx: BackgroundJobClient) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
    },
  ): Promise<T>;
};

const BACKGROUND_JOB_SCHEDULE_MAX_RETRIES = 3;
const MAX_STORED_ERROR_LENGTH = 2000;

const getClient = (client?: BackgroundJobClient) =>
  client ?? (getPrisma() as unknown as BackgroundJobClient);

const truncateJobError = (value: string) =>
  value.length > MAX_STORED_ERROR_LENGTH
    ? `${value.slice(0, MAX_STORED_ERROR_LENGTH)}…`
    : value;

const buildActiveStatusFilter = (now: Date) => ({
  OR: [
    { status: "queued" },
    {
      status: "running",
      OR: [
        { leaseExpiresAt: { gte: now } },
        {
          leaseExpiresAt: null,
          lockedAt: { gte: new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS) },
        },
      ],
    },
  ],
});

const retryDelayMs = (
  attemptCount: number,
  jitterRatio = Math.random() * 0.4 - 0.2,
) => {
  const exponent = Math.max(0, attemptCount - 1);
  const baseDelay = Math.min(
    BACKGROUND_JOB_RETRY_DELAY_MS * 2 ** exponent,
    BACKGROUND_JOB_RETRY_DELAY_MAX_MS,
  );
  return Math.max(1000, Math.round(baseDelay * (1 + jitterRatio)));
};

export const calculateBackgroundJobRetryDelayMs = retryDelayMs;

const isSerializableTransactionConflict = (error: unknown) => {
  const candidate = error as { code?: string; name?: string; message?: string };
  return (
    candidate.code === "P2034" ||
    candidate.name === "TransactionWriteConflict" ||
    candidate.message?.includes("TransactionWriteConflict") === true
  );
};

export const recordBackgroundJobEvent = async ({
  jobId,
  type,
  message = null,
  metadataJson = {},
  workerId = null,
  client,
}: {
  jobId: string;
  type: string;
  message?: string | null;
  metadataJson?: Record<string, unknown>;
  workerId?: string | null;
  client?: BackgroundJobClient;
}) =>
  getClient(client).backgroundJobEvent.create({
    data: {
      jobId,
      type,
      message,
      metadataJson,
      workerId,
    },
  });

export const listBackgroundJobEvents = async ({
  jobId,
  limit = 100,
  client,
}: {
  jobId: string;
  limit?: number;
  client?: BackgroundJobClient;
}) =>
  getClient(client).backgroundJobEvent.findMany({
    where: { jobId },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(limit, 1), 250),
  });

export const findBackgroundJobById = async ({
  jobId,
  client,
}: {
  jobId: string;
  client?: BackgroundJobClient;
}) => getClient(client).backgroundJob.findUnique({ where: { id: jobId } });

export const ensureBackgroundJobScheduled = async ({
  kind,
  runAt,
  payloadJson = {},
  maxAttempts = 5,
  windowEnd = new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
  dedupeKey = null,
  queueName = DEFAULT_BACKGROUND_JOB_QUEUE,
  priority = 0,
  now = new Date(),
  client,
}: {
  kind: SupportedBackgroundJobKind;
  runAt: Date;
  payloadJson?: Record<string, unknown>;
  maxAttempts?: number;
  windowEnd?: Date;
  dedupeKey?: string | null;
  queueName?: string;
  priority?: number;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);
  const dedupeFilter = dedupeKey
    ? { kind, dedupeKey, ...buildActiveStatusFilter(now) }
    : {
        kind,
        queueName,
        ...buildActiveStatusFilter(now),
        runAt: { lte: windowEnd },
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
            orderBy: [{ runAt: "asc" }, { id: "asc" }],
          });

          if (existing) {
            return { created: false, job: existing };
          }

          const job = await tx.backgroundJob.create({
            data: {
              kind,
              queueName,
              priority,
              status: "queued",
              payloadJson,
              progressJson: {},
              dedupeKey,
              runAt,
              maxAttempts,
            },
          });

          await tx.backgroundJobEvent.create({
            data: {
              jobId: job.id,
              type: "queued",
              message: "Job queued.",
              metadataJson: { source: "scheduler" },
            },
          });

          return { created: true, job };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        attempt === BACKGROUND_JOB_SCHEDULE_MAX_RETRIES - 1 ||
        !isSerializableTransactionConflict(error)
      ) {
        throw error;
      }
    }
  }

  throw new Error("Failed to schedule background job.");
};

export const claimDueBackgroundJob = async ({
  workerId,
  queueName = DEFAULT_BACKGROUND_JOB_QUEUE,
  leaseMs = BACKGROUND_JOB_LEASE_MS,
  now = new Date(),
  client,
}: {
  workerId: string;
  queueName?: string;
  leaseMs?: number;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);

  return activeClient.$transaction(async (tx) => {
    const staleLeaseCutoff = new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS);
    const job = await tx.backgroundJob.findFirst({
      where: {
        kind: { in: ALL_SUPPORTED_JOB_KINDS },
        queueName,
        OR: [
          { status: "queued", runAt: { lte: now } },
          { status: "running", leaseExpiresAt: { lte: now } },
          {
            status: "running",
            leaseExpiresAt: null,
            lockedAt: { lte: staleLeaseCutoff },
          },
        ],
      },
      orderBy: [{ priority: "desc" }, { runAt: "asc" }, { id: "asc" }],
    } as object);

    if (!job) {
      return null;
    }

    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    const claimResult = await tx.backgroundJob.updateMany({
      where: {
        id: job.id,
        OR: [
          { status: "queued", runAt: { lte: now } },
          { status: "running", leaseExpiresAt: { lte: now } },
          {
            status: "running",
            leaseExpiresAt: null,
            lockedAt: { lte: staleLeaseCutoff },
          },
        ],
      },
      data: {
        status: "running",
        lockedAt: now,
        lockedBy: workerId,
        leaseExpiresAt,
        startedAt: job.startedAt ?? now,
        timeoutAt: null,
        completedAt: null,
        attemptCount: { increment: 1 },
      },
    } as object);

    if (claimResult.count !== 1) {
      return null;
    }

    await tx.workerInstance
      .update({
        where: { id: workerId },
        data: {
          status: "running",
          currentJobId: job.id,
          lastHeartbeatAt: now,
        },
      })
      .catch(() => null as never);

    await tx.backgroundJobEvent.create({
      data: {
        jobId: job.id,
        type: "claimed",
        message: "Job claimed by worker.",
        workerId,
        metadataJson: { leaseExpiresAt: leaseExpiresAt.toISOString() },
      },
    });

    return tx.backgroundJob.findUnique({ where: { id: job.id } });
  });
};

export const renewBackgroundJobLease = async ({
  jobId,
  workerId,
  leaseMs = BACKGROUND_JOB_LEASE_MS,
  progressJson,
  now = new Date(),
  client,
}: {
  jobId: string;
  workerId: string;
  leaseMs?: number;
  progressJson?: Record<string, unknown>;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);
  const activeClient = getClient(client);
  const result = await activeClient.backgroundJob.updateMany({
    where: {
      id: jobId,
      status: "running",
      lockedBy: workerId,
    },
    data: {
      lockedAt: now,
      leaseExpiresAt,
      ...(progressJson ? { progressJson } : {}),
    },
  } as object);

  if (result.count !== 1) {
    throw new Error(`Background job ${jobId} lease could not be renewed.`);
  }

  await activeClient.workerInstance
    .update({
      where: { id: workerId },
      data: { lastHeartbeatAt: now, currentJobId: jobId, status: "running" },
    })
    .catch(() => null as never);

  return leaseExpiresAt;
};

export const markBackgroundJobSucceeded = async ({
  jobId,
  workerId,
  now = new Date(),
  client,
}: {
  jobId: string;
  workerId?: string;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);
  const where = workerId
    ? { id: jobId, status: "running", lockedBy: workerId }
    : { id: jobId };
  const result = await activeClient.backgroundJob.updateMany({
    where,
    data: {
      status: "succeeded",
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      completedAt: now,
      lastError: null,
      errorCode: null,
    },
  } as object);

  if (result.count !== 1) {
    throw new Error(`Background job ${jobId} could not be marked succeeded.`);
  }

  await activeClient.backgroundJobEvent.create({
    data: {
      jobId,
      type: "succeeded",
      message: "Job completed successfully.",
      workerId: workerId ?? null,
      metadataJson: {},
    },
  });

  return activeClient.backgroundJob.findUnique({ where: { id: jobId } });
};

export const markBackgroundJobTerminal = async ({
  jobId,
  errorMessage,
  errorCode = null,
  workerId,
  now = new Date(),
  client,
}: {
  jobId: string;
  errorMessage: string;
  errorCode?: string | null;
  workerId?: string;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);
  const where = workerId
    ? { id: jobId, status: "running", lockedBy: workerId }
    : { id: jobId };
  const result = await activeClient.backgroundJob.updateMany({
    where,
    data: {
      status: "failed",
      lockedAt: null,
      lockedBy: null,
      leaseExpiresAt: null,
      completedAt: now,
      lastError: truncateJobError(errorMessage),
      errorCode,
    },
  } as object);

  if (result.count !== 1) {
    throw new Error(`Background job ${jobId} could not be marked failed.`);
  }

  await activeClient.backgroundJobEvent.create({
    data: {
      jobId,
      type: "failed",
      message: truncateJobError(errorMessage),
      workerId: workerId ?? null,
      metadataJson: { errorCode, terminal: true },
    },
  });

  return activeClient.backgroundJob.findUnique({ where: { id: jobId } });
};

export const markBackgroundJobFailed = async ({
  jobId,
  errorMessage,
  errorCode = null,
  workerId,
  retryable = true,
  now = new Date(),
  client,
}: {
  jobId: string;
  errorMessage: string;
  errorCode?: string | null;
  workerId?: string;
  retryable?: boolean;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);

  return activeClient.$transaction(async (tx) => {
    const job = await tx.backgroundJob.findUnique({ where: { id: jobId } });

    if (!job) {
      throw new Error(`Background job ${jobId} not found.`);
    }

    if (workerId && job.lockedBy !== workerId) {
      throw new Error(`Background job ${jobId} is locked by another worker.`);
    }

    if (!retryable) {
      return markBackgroundJobTerminal({
        jobId,
        errorMessage,
        errorCode,
        workerId,
        now,
        client: tx,
      });
    }

    const shouldDeadLetter = job.attemptCount >= job.maxAttempts;
    const nextRunAt = new Date(now.getTime() + retryDelayMs(job.attemptCount));
    const updated = await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: shouldDeadLetter ? "dead" : "queued",
        runAt: shouldDeadLetter ? job.runAt : nextRunAt,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        completedAt: shouldDeadLetter ? now : null,
        lastError: truncateJobError(errorMessage),
        errorCode,
      },
    });

    await tx.backgroundJobEvent.create({
      data: {
        jobId,
        type: shouldDeadLetter ? "dead" : "retry_scheduled",
        message: truncateJobError(errorMessage),
        workerId: workerId ?? null,
        metadataJson: {
          errorCode,
          nextRunAt: shouldDeadLetter ? null : nextRunAt.toISOString(),
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
        },
      },
    });

    return updated;
  });
};

export const cancelBackgroundJob = async ({
  jobId,
  actorUserId,
  now = new Date(),
  client,
}: {
  jobId: string;
  actorUserId: string;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);

  return activeClient.$transaction(async (tx) => {
    const job = await tx.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`Background job ${jobId} not found.`);
    if (job.status !== "queued" && job.status !== "running") {
      throw new Error("Only queued or running jobs can be cancelled.");
    }

    const updated = await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        cancelledAt: now,
        cancelledByUserId: actorUserId,
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        lastError: "Cancelled by admin.",
        errorCode: "cancelled",
      },
    });

    await tx.backgroundJobEvent.create({
      data: {
        jobId,
        type: "cancelled",
        message: "Cancelled by admin.",
        metadataJson: { actorUserId },
      },
    });

    return updated;
  });
};

export const retryBackgroundJob = async ({
  jobId,
  actorUserId,
  now = new Date(),
  client,
}: {
  jobId: string;
  actorUserId: string;
  now?: Date;
  client?: BackgroundJobClient;
}) => {
  const activeClient = getClient(client);

  return activeClient.$transaction(async (tx) => {
    const job = await tx.backgroundJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error(`Background job ${jobId} not found.`);
    if (
      job.status !== "failed" &&
      job.status !== "dead" &&
      job.status !== "cancelled"
    ) {
      throw new Error("Only failed, dead, or cancelled jobs can be retried.");
    }

    const updated = await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: "queued",
        runAt: now,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledByUserId: null,
        lastError: null,
        errorCode: null,
        progressJson: {},
      },
    });

    await tx.backgroundJobEvent.create({
      data: {
        jobId,
        type: "retry_requested",
        message: "Retry requested by admin.",
        metadataJson: { actorUserId },
      },
    });

    return updated;
  });
};

export const scheduleZipArchiveGenerate = async ({
  archiveId,
  now = new Date(),
}: {
  archiveId: string;
  now?: Date;
}) =>
  ensureBackgroundJobScheduled({
    kind: ZIP_ARCHIVE_GENERATE_JOB_KIND,
    runAt: now,
    payloadJson: { archiveId },
    dedupeKey: `${ZIP_ARCHIVE_GENERATE_JOB_KIND}:${archiveId}`,
    now,
  });

export const registerWorkerInstance = async ({
  id,
  hostname,
  pid,
  version = null,
  metadataJson = {},
  now = new Date(),
  client,
}: {
  id: string;
  hostname: string;
  pid: number;
  version?: string | null;
  metadataJson?: Record<string, unknown>;
  now?: Date;
  client?: BackgroundJobClient;
}) =>
  getClient(client).workerInstance.upsert({
    where: { id },
    create: {
      id,
      hostname,
      pid,
      version,
      status: "starting",
      startedAt: now,
      lastHeartbeatAt: now,
      metadataJson,
    },
    update: {
      hostname,
      pid,
      version,
      status: "starting",
      startedAt: now,
      stoppedAt: null,
      lastHeartbeatAt: now,
      currentJobId: null,
      metadataJson,
    },
  });

export const heartbeatWorkerInstance = async ({
  id,
  status = "idle",
  currentJobId = null,
  metadataJson,
  now = new Date(),
  client,
}: {
  id: string;
  status?: string;
  currentJobId?: string | null;
  metadataJson?: Record<string, unknown>;
  now?: Date;
  client?: BackgroundJobClient;
}) =>
  getClient(client).workerInstance.update({
    where: { id },
    data: {
      status,
      currentJobId,
      lastHeartbeatAt: now,
      ...(metadataJson ? { metadataJson } : {}),
    },
  });

export const markWorkerInstanceStopped = async ({
  id,
  now = new Date(),
  client,
}: {
  id: string;
  now?: Date;
  client?: BackgroundJobClient;
}) =>
  getClient(client).workerInstance.update({
    where: { id },
    data: {
      status: "stopped",
      stoppedAt: now,
      currentJobId: null,
      lastHeartbeatAt: now,
    },
  });

export const listWorkerInstances = async ({
  limit = 25,
  client,
}: { limit?: number; client?: BackgroundJobClient } = {}) =>
  getClient(client).workerInstance.findMany({
    orderBy: { lastHeartbeatAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });

export type QueueOperationalSummary = {
  statusCounts: Record<BackgroundJobStatus, number> & { total: number };
  countsByKind: Record<string, Partial<Record<BackgroundJobStatus, number>>>;
  oldestQueuedAgeSeconds: number | null;
  oldestDueQueuedAgeSeconds: number | null;
  nextQueuedRunAt: Date | null;
  staleRunning: number;
  failed: number;
  dead: number;
  workers: WorkerInstanceRecord[];
};

export const getQueueOperationalSummary = async ({
  now = new Date(),
  staleLeaseMs = BACKGROUND_JOB_LEASE_MS,
  client,
}: {
  now?: Date;
  staleLeaseMs?: number;
  client?: BackgroundJobClient;
} = {}): Promise<QueueOperationalSummary> => {
  const activeClient = getClient(client);
  const staleCutoff = new Date(now.getTime() - staleLeaseMs);
  const [
    statusGroups,
    oldestQueued,
    oldestDueQueued,
    nextQueued,
    staleRunning,
    workers,
    jobs,
  ] = await Promise.all([
    activeClient.backgroundJob.groupBy({
      by: ["status"],
      _count: { status: true },
    }),
    activeClient.backgroundJob.findFirst({
      where: { status: "queued" },
      orderBy: { runAt: "asc" },
    }),
    activeClient.backgroundJob.findFirst({
      where: { status: "queued", runAt: { lte: now } },
      orderBy: { runAt: "asc" },
    }),
    activeClient.backgroundJob.findFirst({
      where: { status: "queued", runAt: { gt: now } },
      orderBy: { runAt: "asc" },
    }),
    activeClient.backgroundJob.count({
      where: {
        status: "running",
        OR: [
          { leaseExpiresAt: { lte: now } },
          { leaseExpiresAt: null, lockedAt: { lte: staleCutoff } },
        ],
      },
    }),
    listWorkerInstances({ client: activeClient }),
    activeClient.backgroundJob.findMany({
      select: { kind: true, status: true },
      orderBy: { kind: "asc" },
    } as object),
  ]);

  const workerStaleAfterMs = staleLeaseMs * 2;
  const workersWithEffectiveStatus = workers.map((worker) => {
    const heartbeatAgeMs = now.getTime() - worker.lastHeartbeatAt.getTime();

    if (heartbeatAgeMs > workerStaleAfterMs) {
      return {
        ...worker,
        status: "stale",
      };
    }

    return worker;
  });

  const statusCounts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    cancelled: 0,
    total: 0,
  };

  for (const group of statusGroups) {
    statusCounts[group.status] = group._count.status;
    statusCounts.total += group._count.status;
  }

  const countsByKind: QueueOperationalSummary["countsByKind"] = {};
  for (const job of jobs) {
    const row = (countsByKind[job.kind] ??= {});
    row[job.status] = (row[job.status] ?? 0) + 1;
  }

  return {
    statusCounts,
    countsByKind,
    oldestQueuedAgeSeconds: oldestQueued
      ? Math.max(
          0,
          Math.floor((now.getTime() - oldestQueued.runAt.getTime()) / 1000),
        )
      : null,
    oldestDueQueuedAgeSeconds: oldestDueQueued
      ? Math.max(
          0,
          Math.floor((now.getTime() - oldestDueQueued.runAt.getTime()) / 1000),
        )
      : null,
    nextQueuedRunAt: nextQueued?.runAt ?? null,
    staleRunning,
    failed: statusCounts.failed,
    dead: statusCounts.dead,
    workers: workersWithEffectiveStatus,
  };
};
