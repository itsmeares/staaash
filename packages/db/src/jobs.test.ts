import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??=
  "postgresql://staaash:staaash@localhost:5432/staaash";

const {
  BACKGROUND_JOB_LEASE_MS,
  BACKGROUND_JOB_RETRY_DELAY_MS,
  claimDueBackgroundJob,
  ensureBackgroundJobScheduled,
  markBackgroundJobFailed,
} = await import("./jobs");

type DateComparisonFilter = {
  lte?: Date;
  gte?: Date;
};

type MemoryJob = {
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

const createClient = (jobs: MemoryJob[]) => {
  const matchesWhere = (job: MemoryJob, where: any): boolean => {
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
          if ("lte" in dateFilter && !(job[key] && job[key]! <= dateFilter.lte!)) {
            return false;
          }

          if ("gte" in dateFilter && !(job[key] && job[key]! >= dateFilter.gte!)) {
            return false;
          }

          return true;
        }
      }

      return (job as Record<string, unknown>)[key] === value;
    });

    if (!directMatch) {
      return false;
    }

    if (where.OR) {
      return where.OR.some((condition: any) => matchesWhere(job, condition));
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
    async findFirst(args: any) {
      const [job] = sortJobs(jobs.filter((candidate) => matchesWhere(candidate, args.where)));
      return job ?? null;
    },
    async findUnique(args: any) {
      return jobs.find((job) => job.id === args.where.id) ?? null;
    },
    async create(args: any) {
      const now = new Date("2026-04-01T12:00:00.000Z");
      const job: MemoryJob = {
        id: `job-${jobs.length + 1}`,
        kind: args.data.kind,
        status: args.data.status,
        payloadJson: args.data.payloadJson,
        runAt: args.data.runAt,
        lockedAt: null,
        lockedBy: null,
        attemptCount: 0,
        maxAttempts: args.data.maxAttempts,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      };
      jobs.push(job);
      return job;
    },
    async updateMany(args: any) {
      const matched = jobs.filter((job) => matchesWhere(job, args.where));

      for (const job of matched) {
        if ("status" in args.data) {
          job.status = args.data.status;
        }

        if ("lockedAt" in args.data) {
          job.lockedAt = args.data.lockedAt;
        }

        if ("lockedBy" in args.data) {
          job.lockedBy = args.data.lockedBy;
        }

        if ("runAt" in args.data) {
          job.runAt = args.data.runAt;
        }

        if ("lastError" in args.data) {
          job.lastError = args.data.lastError;
        }

        if (args.data.attemptCount?.increment) {
          job.attemptCount += args.data.attemptCount.increment;
        }
      }

      return { count: matched.length };
    },
    async update(args: any) {
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
  };

  return {
    backgroundJob,
    async $transaction<T>(callback: (tx: any) => Promise<T>) {
      return callback({ backgroundJob });
    },
  };
};

const createJob = (overrides: Partial<MemoryJob>): MemoryJob => ({
  id: overrides.id ?? "job-1",
  kind: overrides.kind ?? "staging.cleanup",
  status: overrides.status ?? "queued",
  payloadJson: overrides.payloadJson ?? {},
  runAt: overrides.runAt ?? new Date("2026-04-01T12:00:00.000Z"),
  lockedAt: overrides.lockedAt ?? null,
  lockedBy: overrides.lockedBy ?? null,
  attemptCount: overrides.attemptCount ?? 0,
  maxAttempts: overrides.maxAttempts ?? 5,
  lastError: overrides.lastError ?? null,
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
        kind: "staging.cleanup",
        workerId: "worker-a",
        now,
        client,
      }),
      claimDueBackgroundJob({
        kind: "staging.cleanup",
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

    expect(jobs.find((job) => job.id === "retry-job")).toMatchObject({
      status: "queued",
      lastError: "retry me",
      runAt: new Date(now.getTime() + BACKGROUND_JOB_RETRY_DELAY_MS),
    });
    expect(jobs.find((job) => job.id === "dead-job")).toMatchObject({
      status: "dead",
      lastError: "done retrying",
    });
  });
});
