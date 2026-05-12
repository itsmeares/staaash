import { describe, expect, it } from "vitest";

const {
  BACKGROUND_JOB_LEASE_MS,
  BACKGROUND_JOB_RETRY_DELAY_MS,
  STAGING_CLEANUP_JOB_KIND,
  TRASH_RETENTION_JOB_KIND,
  UPDATE_CHECK_JOB_KIND,
  claimDueBackgroundJob,
  cancelBackgroundJob,
  ensureBackgroundJobScheduled,
  getQueueOperationalSummary,
  listBackgroundJobEvents,
  markBackgroundJobFailed,
  markBackgroundJobTerminal,
  renewBackgroundJobLease,
  retryBackgroundJob,
} = await import("./jobs");

type DateComparisonFilter = {
  lte?: Date;
  gte?: Date;
};

type InFilter = {
  in: string[];
};

type MemoryJob = {
  id: string;
  kind: string;
  queueName: string;
  priority: number;
  status: "queued" | "running" | "succeeded" | "failed" | "dead" | "cancelled";
  payloadJson: unknown;
  progressJson: unknown;
  dedupeKey: string | null;
  runAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  leaseExpiresAt: Date | null;
  timeoutAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type MemoryEvent = {
  id: string;
  jobId: string;
  type: string;
  message: string | null;
  metadataJson: unknown;
  workerId: string | null;
  createdAt: Date;
};

type MemoryWorker = {
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

const createClient = (
  jobs: MemoryJob[],
  events: MemoryEvent[] = [],
  workers: MemoryWorker[] = [],
) => {
  const matchesDateFilter = (
    fieldValue: Date | null,
    filter: DateComparisonFilter,
  ): boolean => {
    if ("lte" in filter && !(fieldValue && fieldValue <= filter.lte!)) {
      return false;
    }

    if ("gte" in filter && !(fieldValue && fieldValue >= filter.gte!)) {
      return false;
    }

    return true;
  };

  const matchesWhere = (
    job: MemoryJob,
    where: Record<string, unknown>,
  ): boolean => {
    if (!where) {
      return true;
    }

    const entries = Object.entries(where).filter(([key]) => key !== "OR");
    const directMatch = entries.every(([key, value]) => {
      if (key === "runAt" || key === "lockedAt") {
        const dateFilter =
          value && typeof value === "object"
            ? (value as DateComparisonFilter)
            : null;

        if (dateFilter) {
          return matchesDateFilter(
            (job as unknown as Record<string, Date | null>)[key],
            dateFilter,
          );
        }
      }

      // Handle { in: [...] } for kind filtering
      if (value && typeof value === "object" && "in" in (value as object)) {
        const inFilter = value as InFilter;
        return inFilter.in.includes(
          (job as unknown as Record<string, string>)[key],
        );
      }

      return (job as Record<string, unknown>)[key] === value;
    });

    if (!directMatch) {
      return false;
    }

    if (where.OR) {
      return (where.OR as Record<string, unknown>[]).some((condition) =>
        matchesWhere(job, condition),
      );
    }

    return true;
  };

  const sortJobs = (items: MemoryJob[]) =>
    [...items].sort(
      (left, right) =>
        left.runAt.getTime() - right.runAt.getTime() ||
        left.id.localeCompare(right.id),
    );

  const backgroundJob = {
    async findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, unknown>;
    }) {
      const [job] = sortJobs(
        jobs.filter((candidate) => matchesWhere(candidate, args.where)),
      );
      return job ?? null;
    },
    async findUnique(args: { where: { id: string } }) {
      return jobs.find((job) => job.id === args.where.id) ?? null;
    },
    async create(args: { data: Partial<MemoryJob> }) {
      const now = new Date("2026-04-01T12:00:00.000Z");
      const job: MemoryJob = {
        id: `job-${jobs.length + 1}`,
        kind: args.data.kind!,
        queueName: args.data.queueName ?? "default",
        priority: args.data.priority ?? 0,
        status: args.data.status as MemoryJob["status"],
        payloadJson: args.data.payloadJson ?? {},
        progressJson: args.data.progressJson ?? {},
        dedupeKey: args.data.dedupeKey ?? null,
        runAt: args.data.runAt!,
        lockedAt: null,
        lockedBy: null,
        leaseExpiresAt: null,
        timeoutAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        cancelledByUserId: null,
        attemptCount: 0,
        maxAttempts: args.data.maxAttempts!,
        lastError: null,
        errorCode: null,
        createdAt: now,
        updatedAt: now,
      };
      jobs.push(job);
      return job;
    },
    async updateMany(args: {
      where: Record<string, unknown>;
      data: Partial<MemoryJob> & { attemptCount?: { increment: number } };
    }) {
      const matched = jobs.filter((job) => matchesWhere(job, args.where));

      for (const job of matched) {
        if ("status" in args.data) {
          job.status = args.data.status as MemoryJob["status"];
        }

        if ("lockedAt" in args.data) {
          job.lockedAt = args.data.lockedAt ?? null;
        }

        if ("lockedBy" in args.data) {
          job.lockedBy = args.data.lockedBy ?? null;
        }

        if ("leaseExpiresAt" in args.data) {
          job.leaseExpiresAt = args.data.leaseExpiresAt ?? null;
        }

        if ("startedAt" in args.data) {
          job.startedAt = args.data.startedAt ?? null;
        }

        if ("completedAt" in args.data) {
          job.completedAt = args.data.completedAt ?? null;
        }

        if ("cancelledAt" in args.data) {
          job.cancelledAt = args.data.cancelledAt ?? null;
        }

        if ("cancelledByUserId" in args.data) {
          job.cancelledByUserId = args.data.cancelledByUserId ?? null;
        }

        if ("runAt" in args.data) {
          job.runAt = args.data.runAt!;
        }

        if ("lastError" in args.data) {
          job.lastError = args.data.lastError ?? null;
        }

        if ("errorCode" in args.data) {
          job.errorCode = args.data.errorCode ?? null;
        }

        if ("progressJson" in args.data) {
          job.progressJson = args.data.progressJson ?? {};
        }

        if (args.data.attemptCount?.increment) {
          job.attemptCount += args.data.attemptCount.increment;
        }
      }

      return { count: matched.length };
    },
    async update(args: {
      where: { id: string };
      data: Partial<MemoryJob> & { attemptCount?: { increment: number } };
    }) {
      const job = jobs.find((candidate) => candidate.id === args.where.id);

      if (!job) {
        throw new Error(`Missing job ${args.where.id}`);
      }

      await backgroundJob.updateMany({
        where: { id: job.id },
        data: args.data,
      });

      return job;
    },
    async count(args?: { where?: Record<string, unknown> }) {
      return jobs.filter((job) => matchesWhere(job, args?.where ?? {})).length;
    },
    async findMany(args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, "asc" | "desc">;
      take?: number;
      select?: { kind?: true; status?: true };
    }) {
      let filtered = jobs.filter((job) => matchesWhere(job, args.where ?? {}));
      if (args.orderBy?.kind) {
        filtered = [...filtered].sort((a, b) => a.kind.localeCompare(b.kind));
      }
      return filtered.slice(0, args.take ?? filtered.length);
    },
    async groupBy() {
      const counts = new Map<MemoryJob["status"], number>();
      for (const job of jobs) {
        counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
      }
      return [...counts.entries()].map(([status, count]) => ({
        status,
        _count: { status: count },
      }));
    },
  };

  const backgroundJobEvent = {
    async create(args: { data: Partial<MemoryEvent> }) {
      const event: MemoryEvent = {
        id: `event-${events.length + 1}`,
        jobId: args.data.jobId!,
        type: args.data.type!,
        message: args.data.message ?? null,
        metadataJson: args.data.metadataJson ?? {},
        workerId: args.data.workerId ?? null,
        createdAt: new Date("2026-04-01T12:00:00.000Z"),
      };
      events.push(event);
      return event;
    },
    async findMany(args: { where: { jobId: string }; take?: number }) {
      return events
        .filter((event) => event.jobId === args.where.jobId)
        .slice(0, args.take ?? events.length);
    },
  };

  const workerInstance = {
    async update(args: { where: { id: string }; data: Partial<MemoryWorker> }) {
      let worker = workers.find((candidate) => candidate.id === args.where.id);
      if (!worker) {
        worker = {
          id: args.where.id,
          hostname: "host",
          pid: 1,
          version: null,
          startedAt: new Date("2026-04-01T12:00:00.000Z"),
          lastHeartbeatAt: new Date("2026-04-01T12:00:00.000Z"),
          stoppedAt: null,
          status: "idle",
          currentJobId: null,
          metadataJson: {},
          createdAt: new Date("2026-04-01T12:00:00.000Z"),
          updatedAt: new Date("2026-04-01T12:00:00.000Z"),
        };
        workers.push(worker);
      }
      Object.assign(worker, args.data);
      return worker;
    },
    async upsert() {
      throw new Error("not used");
    },
    async findMany() {
      return workers;
    },
  };

  return {
    backgroundJob,
    backgroundJobEvent,
    workerInstance,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async $transaction<T>(callback: (tx: any) => Promise<T>) {
      return callback({ backgroundJob, backgroundJobEvent, workerInstance });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
};

const createJob = (overrides: Partial<MemoryJob>): MemoryJob => ({
  id: overrides.id ?? "job-1",
  kind: overrides.kind ?? "staging.cleanup",
  queueName: overrides.queueName ?? "default",
  priority: overrides.priority ?? 0,
  status: overrides.status ?? "queued",
  payloadJson: overrides.payloadJson ?? {},
  progressJson: overrides.progressJson ?? {},
  dedupeKey: overrides.dedupeKey ?? null,
  runAt: overrides.runAt ?? new Date("2026-04-01T12:00:00.000Z"),
  lockedAt: overrides.lockedAt ?? null,
  lockedBy: overrides.lockedBy ?? null,
  leaseExpiresAt: overrides.leaseExpiresAt ?? null,
  timeoutAt: overrides.timeoutAt ?? null,
  startedAt: overrides.startedAt ?? null,
  completedAt: overrides.completedAt ?? null,
  cancelledAt: overrides.cancelledAt ?? null,
  cancelledByUserId: overrides.cancelledByUserId ?? null,
  attemptCount: overrides.attemptCount ?? 0,
  maxAttempts: overrides.maxAttempts ?? 5,
  lastError: overrides.lastError ?? null,
  errorCode: overrides.errorCode ?? null,
  createdAt: overrides.createdAt ?? new Date("2026-04-01T11:59:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-04-01T11:59:00.000Z"),
});

describe("background jobs", () => {
  it("schedules a new job when an older running lease is stale", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs = [
      createJob({
        id: "stale-running",
        status: "running",
        lockedAt: new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS - 1),
      }),
    ];

    const result = await ensureBackgroundJobScheduled({
      kind: "staging.cleanup",
      runAt: now,
      client: createClient(jobs),
      now,
    });

    expect(result.created).toBe(true);
    expect(jobs).toHaveLength(2);
  });

  it("reclaims stale running jobs and only lets one claimer win", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs = [
      createJob({
        id: "reclaim-me",
        status: "running",
        lockedAt: new Date(now.getTime() - BACKGROUND_JOB_LEASE_MS - 1),
      }),
    ];
    const client = createClient(jobs);

    const [first, second] = await Promise.all([
      claimDueBackgroundJob({
        workerId: "worker-a",
        now,
        client,
      }),
      claimDueBackgroundJob({
        workerId: "worker-b",
        now,
        client,
      }),
    ]);

    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      status: "running",
      attemptCount: 1,
    });
  });

  it("requeues failed jobs until max attempts then dead-letters them", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs = [
      createJob({
        id: "retry-job",
        status: "running",
        attemptCount: 1,
        maxAttempts: 3,
      }),
      createJob({
        id: "dead-job",
        status: "running",
        attemptCount: 3,
        maxAttempts: 3,
      }),
    ];
    const client = createClient(jobs);

    await markBackgroundJobFailed({
      jobId: "retry-job",
      errorMessage: "retry me",
      now,
      client,
    });
    await markBackgroundJobFailed({
      jobId: "dead-job",
      errorMessage: "done retrying",
      now,
      client,
    });

    const retryJob = jobs.find((job) => job.id === "retry-job");
    expect(retryJob).toMatchObject({
      status: "queued",
      lastError: "retry me",
    });
    expect(retryJob!.runAt.getTime()).toBeGreaterThanOrEqual(
      now.getTime() + BACKGROUND_JOB_RETRY_DELAY_MS * 0.8,
    );
    expect(retryJob!.runAt.getTime()).toBeLessThanOrEqual(
      now.getTime() + BACKGROUND_JOB_RETRY_DELAY_MS * 1.2,
    );
    expect(jobs.find((job) => job.id === "dead-job")).toMatchObject({
      status: "dead",
      lastError: "done retrying",
    });
  });

  it("deduplicates keyed jobs by dedupeKey", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs: MemoryJob[] = [];
    const client = createClient(jobs);
    const dedupeKey = "staging:tenant-1";

    // First enqueue — should create
    const first = await ensureBackgroundJobScheduled({
      kind: STAGING_CLEANUP_JOB_KIND,
      runAt: now,
      dedupeKey,
      payloadJson: { tenantId: "tenant-1" },
      client,
      now,
    });

    // Second enqueue with same key — should deduplicate
    const second = await ensureBackgroundJobScheduled({
      kind: STAGING_CLEANUP_JOB_KIND,
      runAt: now,
      dedupeKey,
      payloadJson: { tenantId: "tenant-1" },
      client,
      now,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(jobs).toHaveLength(1);
  });

  it("retries scheduling when a serializable transaction is rolled back", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs: MemoryJob[] = [];
    const baseClient = createClient(jobs);
    let attempts = 0;
    const client = {
      ...baseClient,
      async $transaction<T>(callback: (tx: typeof baseClient) => Promise<T>) {
        attempts += 1;

        if (attempts === 1) {
          const error = new Error("serialization failure") as Error & {
            code?: string;
          };
          error.code = "P2034";
          throw error;
        }

        return baseClient.$transaction(callback);
      },
    };

    const result = await ensureBackgroundJobScheduled({
      kind: UPDATE_CHECK_JOB_KIND,
      runAt: now,
      client,
      now,
    });

    expect(result.created).toBe(true);
    expect(attempts).toBe(2);
    expect(jobs).toHaveLength(1);
  });

  it("multi-kind dispatcher claims the earliest due job across kinds", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const earlier = new Date(now.getTime() - 1000);
    const jobs = [
      createJob({
        id: "cleanup-job",
        kind: STAGING_CLEANUP_JOB_KIND,
        status: "queued",
        runAt: now,
      }),
      createJob({
        id: "update-job",
        kind: UPDATE_CHECK_JOB_KIND,
        status: "queued",
        runAt: earlier,
      }),
    ];
    const client = createClient(jobs);

    const claimed = await claimDueBackgroundJob({
      workerId: "worker-a",
      now,
      client,
    });

    expect(claimed?.id).toBe("update-job");
    expect(claimed?.kind).toBe(UPDATE_CHECK_JOB_KIND);
  });

  it("singleton periodic jobs do not duplicate within their kind", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs: MemoryJob[] = [];
    const client = createClient(jobs);

    await ensureBackgroundJobScheduled({
      kind: TRASH_RETENTION_JOB_KIND,
      runAt: now,
      payloadJson: {},
      client,
      now,
    });

    await ensureBackgroundJobScheduled({
      kind: TRASH_RETENTION_JOB_KIND,
      runAt: now,
      payloadJson: {},
      client,
      now,
    });

    expect(jobs).toHaveLength(1);
  });

  it("update.check job can be scheduled as a singleton", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs: MemoryJob[] = [];
    const client = createClient(jobs);

    await ensureBackgroundJobScheduled({
      kind: UPDATE_CHECK_JOB_KIND,
      runAt: now,
      client,
      now,
    });

    await ensureBackgroundJobScheduled({
      kind: UPDATE_CHECK_JOB_KIND,
      runAt: now,
      client,
      now,
    });

    expect(jobs).toHaveLength(1);
  });

  it("markBackgroundJobFailed returns the updated job record", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs = [
      createJob({
        id: "check-return",
        status: "running",
        attemptCount: 1,
        maxAttempts: 5,
      }),
    ];
    const client = createClient(jobs);

    const updated = await markBackgroundJobFailed({
      jobId: "check-return",
      errorMessage: "transient error",
      now,
      client,
    });

    expect(updated).toMatchObject({
      status: "queued",
      lastError: "transient error",
    });
  });

  it("marks terminal jobs failed without requeueing them", async () => {
    const jobs = [
      createJob({
        id: "terminal-job",
        status: "running",
        attemptCount: 1,
        maxAttempts: 5,
      }),
    ];
    const client = createClient(jobs);

    const updated = await markBackgroundJobTerminal({
      jobId: "terminal-job",
      errorMessage: "non-retryable failure",
      client,
    });

    expect(updated).toMatchObject({
      status: "failed",
      lockedAt: null,
      lockedBy: null,
      lastError: "non-retryable failure",
    });
    expect(jobs[0]?.runAt).toEqual(new Date("2026-04-01T12:00:00.000Z"));
  });

  it("renews leases only for the owning worker", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs = [
      createJob({
        id: "lease-job",
        status: "running",
        lockedBy: "worker-a",
      }),
    ];

    const leaseExpiresAt = await renewBackgroundJobLease({
      jobId: "lease-job",
      workerId: "worker-a",
      now,
      client: createClient(jobs),
    });

    expect(jobs[0]?.leaseExpiresAt).toEqual(leaseExpiresAt);
    await expect(
      renewBackgroundJobLease({
        jobId: "lease-job",
        workerId: "worker-b",
        now,
        client: createClient(jobs),
      }),
    ).rejects.toThrow("could not be renewed");
  });

  it("cancels queued jobs and retries cancelled jobs", async () => {
    const now = new Date("2026-04-01T12:00:00.000Z");
    const jobs = [createJob({ id: "cancel-me", status: "queued" })];
    const client = createClient(jobs);

    await cancelBackgroundJob({
      jobId: "cancel-me",
      actorUserId: "owner-1",
      now,
      client,
    });

    expect(jobs[0]).toMatchObject({
      status: "cancelled",
      cancelledByUserId: "owner-1",
      lastError: "Cancelled by admin.",
    });

    await retryBackgroundJob({
      jobId: "cancel-me",
      actorUserId: "owner-1",
      now,
      client,
    });

    expect(jobs[0]).toMatchObject({
      status: "queued",
      cancelledByUserId: null,
      lastError: null,
    });
  });

  it("records events and summarizes queue operations", async () => {
    const events: MemoryEvent[] = [];
    const jobs = [
      createJob({ id: "queued-job", status: "queued" }),
      createJob({ id: "dead-job", status: "dead" }),
      createJob({
        id: "stale-running",
        status: "running",
        lockedAt: new Date("2026-04-01T11:58:00.000Z"),
      }),
    ];
    const client = createClient(jobs, events);

    await cancelBackgroundJob({
      jobId: "queued-job",
      actorUserId: "owner-1",
      client,
    });

    const jobEvents = await listBackgroundJobEvents({
      jobId: "queued-job",
      client,
    });
    const summary = await getQueueOperationalSummary({
      now: new Date("2026-04-01T12:00:00.000Z"),
      client,
    });

    expect(jobEvents.map((event) => event.type)).toContain("cancelled");
    expect(summary.statusCounts.cancelled).toBe(1);
    expect(summary.dead).toBe(1);
    expect(summary.staleRunning).toBe(1);
  });
});
