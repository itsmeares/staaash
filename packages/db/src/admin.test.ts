import { describe, expect, it } from "vitest";

const { getAdminStorageUsageSummary, listAdminBackgroundJobs } =
  await import("./admin");

type MemoryUser = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: "owner" | "member";
  createdAt: Date;
};

type MemoryFile = {
  id: string;
  ownerUserId: string;
  sizeBytes: bigint;
  updatedAt: Date;
};

type MemoryFolder = {
  id: string;
  ownerUserId: string;
  isLibraryRoot: boolean;
  updatedAt: Date;
};

type MemoryJob = {
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

const createClient = ({
  users,
  files,
  folders,
  jobs,
}: {
  users: MemoryUser[];
  files: MemoryFile[];
  folders: MemoryFolder[];
  jobs: MemoryJob[];
}) =>
  ({
    user: {
      async findMany() {
        return [...users].sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        );
      },
    },
    file: {
      async groupBy() {
        const groups = new Map<
          string,
          {
            ownerUserId: string;
            _count: { id: number };
            _sum: { sizeBytes: bigint | null };
            _max: { updatedAt: Date | null };
          }
        >();

        for (const file of files) {
          const current = groups.get(file.ownerUserId) ?? {
            ownerUserId: file.ownerUserId,
            _count: { id: 0 },
            _sum: { sizeBytes: 0n },
            _max: { updatedAt: null },
          };
          current._count.id += 1;
          current._sum.sizeBytes =
            (current._sum.sizeBytes ?? 0n) + file.sizeBytes;
          current._max.updatedAt =
            current._max.updatedAt && current._max.updatedAt > file.updatedAt
              ? current._max.updatedAt
              : file.updatedAt;
          groups.set(file.ownerUserId, current);
        }

        return [...groups.values()];
      },
    },
    folder: {
      async groupBy(args: { where?: { isLibraryRoot?: boolean } }) {
        const relevantFolders = folders.filter(
          (folder) =>
            args.where?.isLibraryRoot === undefined ||
            folder.isLibraryRoot === args.where.isLibraryRoot,
        );
        const groups = new Map<
          string,
          {
            ownerUserId: string;
            _count: { id: number };
            _max: { updatedAt: Date | null };
          }
        >();

        for (const folder of relevantFolders) {
          const current = groups.get(folder.ownerUserId) ?? {
            ownerUserId: folder.ownerUserId,
            _count: { id: 0 },
            _max: { updatedAt: null },
          };
          current._count.id += 1;
          current._max.updatedAt =
            current._max.updatedAt && current._max.updatedAt > folder.updatedAt
              ? current._max.updatedAt
              : folder.updatedAt;
          groups.set(folder.ownerUserId, current);
        }

        return [...groups.values()];
      },
    },
    backgroundJob: {
      async count() {
        return jobs.length;
      },
      async findMany(args: {
        where?: { status?: string; kind?: string };
        distinct?: string[];
        orderBy?: Array<{ updatedAt?: "desc"; id?: "desc" }> | { kind: "asc" };
        take?: number;
        cursor?: { id: string };
        skip?: number;
        select?: { kind: true };
      }) {
        if (args.distinct?.includes("kind")) {
          return [...new Set(jobs.map((job) => job.kind))]
            .sort((left, right) => left.localeCompare(right))
            .map((kind) => ({ kind }));
        }

        let filtered = jobs.filter((job) => {
          if (args.where?.status && job.status !== args.where.status) {
            return false;
          }

          if (args.where?.kind && job.kind !== args.where.kind) {
            return false;
          }

          return true;
        });

        filtered = [...filtered].sort(
          (left, right) =>
            right.updatedAt.getTime() - left.updatedAt.getTime() ||
            right.id.localeCompare(left.id),
        );

        if (args.cursor) {
          const index = filtered.findIndex((job) => job.id === args.cursor?.id);

          if (index >= 0) {
            filtered = filtered.slice(index + (args.skip ?? 0));
          }
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
          _count: {
            status: count,
          },
        }));
      },
    },
  }) as const;

const createJob = (overrides: Partial<MemoryJob>): MemoryJob => ({
  id: overrides.id ?? "job-1",
  kind: overrides.kind ?? "update.check",
  status: overrides.status ?? "queued",
  payloadJson: overrides.payloadJson ?? {},
  dedupeKey: overrides.dedupeKey ?? null,
  runAt: overrides.runAt ?? new Date("2026-04-06T10:00:00.000Z"),
  lockedAt: overrides.lockedAt ?? null,
  lockedBy: overrides.lockedBy ?? null,
  attemptCount: overrides.attemptCount ?? 0,
  maxAttempts: overrides.maxAttempts ?? 5,
  lastError: overrides.lastError ?? null,
  createdAt: overrides.createdAt ?? new Date("2026-04-06T09:00:00.000Z"),
  updatedAt: overrides.updatedAt ?? new Date("2026-04-06T09:00:00.000Z"),
});

describe("admin db helpers", () => {
  it("aggregates instance and per-user storage usage", async () => {
    const summary = await getAdminStorageUsageSummary(
      createClient({
        users: [
          {
            id: "owner-1",
            email: "owner@example.com",
            username: "owner",
            displayName: "Owner",
            role: "owner",
            createdAt: new Date("2026-04-01T09:00:00.000Z"),
          },
          {
            id: "member-1",
            email: "member@example.com",
            username: "member",
            displayName: null,
            role: "member",
            createdAt: new Date("2026-04-02T09:00:00.000Z"),
          },
        ],
        files: [
          {
            id: "file-1",
            ownerUserId: "member-1",
            sizeBytes: 12n,
            updatedAt: new Date("2026-04-06T08:00:00.000Z"),
          },
          {
            id: "file-2",
            ownerUserId: "member-1",
            sizeBytes: 8n,
            updatedAt: new Date("2026-04-05T08:00:00.000Z"),
          },
        ],
        folders: [
          {
            id: "root-1",
            ownerUserId: "member-1",
            isLibraryRoot: true,
            updatedAt: new Date("2026-04-01T08:00:00.000Z"),
          },
          {
            id: "folder-1",
            ownerUserId: "member-1",
            isLibraryRoot: false,
            updatedAt: new Date("2026-04-04T08:00:00.000Z"),
          },
        ],
        jobs: [],
      }),
    );

    expect(summary.totalUsers).toBe(2);
    expect(summary.retainedFileCount).toBe(2);
    expect(summary.retainedFolderCount).toBe(1);
    expect(summary.retainedBytes).toBe(20n);
    expect(summary.rows[0]).toMatchObject({
      userId: "owner-1",
      retainedFileCount: 0,
      retainedFolderCount: 0,
      retainedBytes: 0n,
      lastContentActivityAt: null,
    });
    expect(summary.rows[1]).toMatchObject({
      userId: "member-1",
      retainedFileCount: 2,
      retainedFolderCount: 1,
      retainedBytes: 20n,
    });
  });

  it("lists recent background jobs with filters and pagination", async () => {
    const result = await listAdminBackgroundJobs(
      {
        kind: "update.check",
        limit: 1,
      },
      createClient({
        users: [],
        files: [],
        folders: [],
        jobs: [
          createJob({
            id: "job-1",
            kind: "update.check",
            status: "failed",
            updatedAt: new Date("2026-04-06T10:00:00.000Z"),
          }),
          createJob({
            id: "job-2",
            kind: "trash.retention",
            status: "succeeded",
            updatedAt: new Date("2026-04-06T09:00:00.000Z"),
          }),
          createJob({
            id: "job-3",
            kind: "update.check",
            status: "queued",
            updatedAt: new Date("2026-04-06T08:00:00.000Z"),
          }),
        ],
      }),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe("job-1");
    expect(result.nextCursor).toBe("job-3");
    expect(result.availableKinds).toEqual(["trash.retention", "update.check"]);
    expect(result.statusCounts).toMatchObject({
      queued: 1,
      running: 0,
      succeeded: 1,
      failed: 1,
      dead: 0,
      total: 3,
    });
  });
});
