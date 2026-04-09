import { describe, expect, it } from "vitest";

const {
  completeRestoreReconciliationRun,
  createRestoreReconciliationRun,
  failRestoreReconciliationRun,
  findRestoreReconciliationRunByBackgroundJobId,
  listRecentRestoreReconciliationRuns,
  markRestoreReconciliationRunQueued,
  markRestoreReconciliationRunRunning,
  readLatestRestoreReconciliationRun,
} = await import("./reconciliation");

type MemoryRun = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  triggeredByUserId: string | null;
  backgroundJobId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  missingOriginalCount: number;
  orphanedStorageCount: number;
  detailsJson: unknown;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const createClient = (runs: MemoryRun[]) =>
  ({
    restoreReconciliationRun: {
      async findUnique(args: { where: { backgroundJobId: string } }) {
        return (
          runs.find(
            (run) => run.backgroundJobId === args.where.backgroundJobId,
          ) ?? null
        );
      },
      async findFirst() {
        return (
          [...runs].sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime() ||
              right.id.localeCompare(left.id),
          )[0] ?? null
        );
      },
      async findMany(args: { take?: number }) {
        return [...runs]
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime() ||
              right.id.localeCompare(left.id),
          )
          .slice(0, args.take ?? runs.length);
      },
      async create(args: { data: Partial<MemoryRun> }) {
        const now = new Date(`2026-04-09T10:0${runs.length}:00.000Z`);
        const run: MemoryRun = {
          id: `run-${runs.length + 1}`,
          status: (args.data.status as MemoryRun["status"]) ?? "queued",
          triggeredByUserId: args.data.triggeredByUserId ?? null,
          backgroundJobId: args.data.backgroundJobId ?? null,
          startedAt: null,
          completedAt: null,
          missingOriginalCount: 0,
          orphanedStorageCount: 0,
          detailsJson: args.data.detailsJson ?? null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        };
        runs.push(run);
        return run;
      },
      async update(args: {
        where: { backgroundJobId: string };
        data: Partial<MemoryRun>;
      }) {
        const run = runs.find(
          (candidate) =>
            candidate.backgroundJobId === args.where.backgroundJobId,
        );

        if (!run) {
          throw new Error("Run not found.");
        }

        Object.assign(run, args.data, {
          updatedAt: new Date("2026-04-09T11:00:00.000Z"),
        });

        return run;
      },
    },
  }) as const;

describe("restore reconciliation db helpers", () => {
  it("creates queued runs and reads them back by job id", async () => {
    const runs: MemoryRun[] = [];
    const client = createClient(runs);

    const created = await createRestoreReconciliationRun(
      {
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-1",
      },
      client,
    );

    expect(created.status).toBe("queued");
    expect(created.details).toEqual({
      missingOriginals: [],
      orphanedStorageKeys: [],
    });

    await expect(
      findRestoreReconciliationRunByBackgroundJobId("job-1", client),
    ).resolves.toMatchObject({
      id: created.id,
      triggeredByUserId: "owner-1",
    });
  });

  it("marks runs running, succeeded, and failed with normalized details", async () => {
    const runs: MemoryRun[] = [
      {
        id: "run-1",
        status: "queued",
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-1",
        startedAt: null,
        completedAt: null,
        missingOriginalCount: 0,
        orphanedStorageCount: 0,
        detailsJson: null,
        lastError: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        updatedAt: new Date("2026-04-09T10:00:00.000Z"),
      },
      {
        id: "run-2",
        status: "queued",
        triggeredByUserId: null,
        backgroundJobId: "job-2",
        startedAt: null,
        completedAt: null,
        missingOriginalCount: 0,
        orphanedStorageCount: 0,
        detailsJson: null,
        lastError: null,
        createdAt: new Date("2026-04-09T09:00:00.000Z"),
        updatedAt: new Date("2026-04-09T09:00:00.000Z"),
      },
    ];
    const client = createClient(runs);

    await expect(
      markRestoreReconciliationRunRunning(
        {
          backgroundJobId: "job-1",
          startedAt: new Date("2026-04-09T10:05:00.000Z"),
        },
        client,
      ),
    ).resolves.toMatchObject({
      status: "running",
    });

    await expect(
      completeRestoreReconciliationRun(
        {
          backgroundJobId: "job-1",
          completedAt: new Date("2026-04-09T10:06:00.000Z"),
          details: {
            missingOriginals: [
              {
                fileId: "file-1",
                storageKey: "library/member/file-1.txt",
              },
            ],
            orphanedStorageKeys: ["library/member/orphan.txt"],
          },
        },
        client,
      ),
    ).resolves.toMatchObject({
      status: "succeeded",
      missingOriginalCount: 1,
      orphanedStorageCount: 1,
      details: {
        missingOriginals: [
          {
            fileId: "file-1",
            storageKey: "library/member/file-1.txt",
          },
        ],
        orphanedStorageKeys: ["library/member/orphan.txt"],
      },
    });

    await expect(
      markRestoreReconciliationRunQueued(
        {
          backgroundJobId: "job-1",
          errorMessage: "retrying",
        },
        client,
      ),
    ).resolves.toMatchObject({
      status: "queued",
      lastError: "retrying",
    });

    await expect(
      failRestoreReconciliationRun(
        {
          backgroundJobId: "job-2",
          errorMessage: "scan failed",
        },
        client,
      ),
    ).resolves.toMatchObject({
      status: "failed",
      lastError: "scan failed",
    });
  });

  it("reads latest and recent runs in descending order", async () => {
    const runs: MemoryRun[] = [
      {
        id: "run-1",
        status: "succeeded",
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-1",
        startedAt: null,
        completedAt: null,
        missingOriginalCount: 0,
        orphanedStorageCount: 0,
        detailsJson: {},
        lastError: null,
        createdAt: new Date("2026-04-09T08:00:00.000Z"),
        updatedAt: new Date("2026-04-09T08:00:00.000Z"),
      },
      {
        id: "run-2",
        status: "failed",
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-2",
        startedAt: null,
        completedAt: null,
        missingOriginalCount: 0,
        orphanedStorageCount: 0,
        detailsJson: {},
        lastError: "boom",
        createdAt: new Date("2026-04-09T09:00:00.000Z"),
        updatedAt: new Date("2026-04-09T09:00:00.000Z"),
      },
    ];
    const client = createClient(runs);

    await expect(
      readLatestRestoreReconciliationRun(client),
    ).resolves.toMatchObject({
      id: "run-2",
    });
    await expect(
      listRecentRestoreReconciliationRuns(
        {
          limit: 1,
        },
        client,
      ),
    ).resolves.toHaveLength(1);
  });
});
