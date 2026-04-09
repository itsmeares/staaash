import { getPrisma } from "./client";
import type { BackgroundJobRecord } from "./jobs";

type UserRecord = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: "owner" | "member";
  createdAt: Date;
};

type FileUsageGroup = {
  ownerUserId: string;
  _count: {
    id: number;
  };
  _sum: {
    sizeBytes: bigint | null;
  };
  _max: {
    updatedAt: Date | null;
  };
};

type FolderUsageGroup = {
  ownerUserId: string;
  _count: {
    id: number;
  };
  _max: {
    updatedAt: Date | null;
  };
};

type BackgroundJobKindRecord = {
  kind: string;
};

type BackgroundJobStatusGroup = {
  status: BackgroundJobRecord["status"];
  _count: {
    status: number;
  };
};

type AdminClient = {
  user: {
    findMany(args: object): Promise<UserRecord[]>;
  };
  file: {
    groupBy(args: object): Promise<FileUsageGroup[]>;
  };
  folder: {
    groupBy(args: object): Promise<FolderUsageGroup[]>;
  };
  backgroundJob: {
    count(args?: object): Promise<number>;
    findMany(
      args: object,
    ): Promise<BackgroundJobRecord[] | BackgroundJobKindRecord[]>;
    groupBy(args: object): Promise<BackgroundJobStatusGroup[]>;
  };
};

export type AdminUserStorageRow = {
  userId: string;
  email: string;
  username: string;
  displayName: string | null;
  role: "owner" | "member";
  createdAt: Date;
  retainedFileCount: number;
  retainedFolderCount: number;
  retainedBytes: bigint;
  lastContentActivityAt: Date | null;
};

export type AdminStorageUsageSummary = {
  totalUsers: number;
  retainedFileCount: number;
  retainedFolderCount: number;
  retainedBytes: bigint;
  rows: AdminUserStorageRow[];
};

export type AdminBackgroundJobListFilters = {
  status?: BackgroundJobRecord["status"] | null;
  kind?: string | null;
  limit?: number;
  cursor?: string | null;
};

export type AdminBackgroundJobStatusCounts = Record<
  BackgroundJobRecord["status"],
  number
> & {
  total: number;
};

export type AdminBackgroundJobListResult = {
  items: BackgroundJobRecord[];
  nextCursor: string | null;
  availableKinds: string[];
  statusCounts: AdminBackgroundJobStatusCounts;
};

const buildStorageActivityTimestamp = (
  fileUpdatedAt: Date | null,
  folderUpdatedAt: Date | null,
) => {
  if (fileUpdatedAt && folderUpdatedAt) {
    return fileUpdatedAt > folderUpdatedAt ? fileUpdatedAt : folderUpdatedAt;
  }

  return fileUpdatedAt ?? folderUpdatedAt ?? null;
};

export const getAdminStorageUsageSummary = async (
  client?: AdminClient,
): Promise<AdminStorageUsageSummary> => {
  const activeClient = client ?? (getPrisma() as unknown as AdminClient);

  const [users, fileGroups, folderGroups] = await Promise.all([
    activeClient.user.findMany({
      orderBy: {
        createdAt: "asc",
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    }),
    activeClient.file.groupBy({
      by: ["ownerUserId"],
      _count: {
        id: true,
      },
      _sum: {
        sizeBytes: true,
      },
      _max: {
        updatedAt: true,
      },
    }),
    activeClient.folder.groupBy({
      by: ["ownerUserId"],
      where: {
        isLibraryRoot: false,
      },
      _count: {
        id: true,
      },
      _max: {
        updatedAt: true,
      },
    }),
  ]);

  const fileUsageByOwner = new Map(
    fileGroups.map((group) => [group.ownerUserId, group] as const),
  );
  const folderUsageByOwner = new Map(
    folderGroups.map((group) => [group.ownerUserId, group] as const),
  );

  const rows = users.map((user) => {
    const fileUsage = fileUsageByOwner.get(user.id);
    const folderUsage = folderUsageByOwner.get(user.id);

    return {
      userId: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      retainedFileCount: fileUsage?._count.id ?? 0,
      retainedFolderCount: folderUsage?._count.id ?? 0,
      retainedBytes: fileUsage?._sum.sizeBytes ?? 0n,
      lastContentActivityAt: buildStorageActivityTimestamp(
        fileUsage?._max.updatedAt ?? null,
        folderUsage?._max.updatedAt ?? null,
      ),
    } satisfies AdminUserStorageRow;
  });

  return {
    totalUsers: rows.length,
    retainedFileCount: rows.reduce(
      (total, row) => total + row.retainedFileCount,
      0,
    ),
    retainedFolderCount: rows.reduce(
      (total, row) => total + row.retainedFolderCount,
      0,
    ),
    retainedBytes: rows.reduce((total, row) => total + row.retainedBytes, 0n),
    rows,
  };
};

const normalizeJobListLimit = (value: number | undefined) => {
  if (!value) {
    return 25;
  }

  return Math.min(Math.max(value, 1), 100);
};

const buildJobWhere = ({
  status,
  kind,
}: Pick<AdminBackgroundJobListFilters, "status" | "kind">) => ({
  ...(status ? { status } : {}),
  ...(kind ? { kind } : {}),
});

export const listAdminBackgroundJobs = async (
  filters: AdminBackgroundJobListFilters = {},
  client?: AdminClient,
): Promise<AdminBackgroundJobListResult> => {
  const activeClient = client ?? (getPrisma() as unknown as AdminClient);
  const limit = normalizeJobListLimit(filters.limit);
  const where = buildJobWhere(filters);

  const [items, kindRows, statusGroups, total] = await Promise.all([
    activeClient.backgroundJob.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(filters.cursor
        ? {
            cursor: {
              id: filters.cursor,
            },
            skip: 1,
          }
        : {}),
    }) as Promise<BackgroundJobRecord[]>,
    activeClient.backgroundJob.findMany({
      select: {
        kind: true,
      },
      distinct: ["kind"],
      orderBy: {
        kind: "asc",
      },
    }) as Promise<BackgroundJobKindRecord[]>,
    activeClient.backgroundJob.groupBy({
      by: ["status"],
      _count: {
        status: true,
      },
    }),
    activeClient.backgroundJob.count(),
  ]);

  const nextCursor = items.length > limit ? items[limit]!.id : null;
  const pageItems = items.slice(0, limit);

  const statusCounts: AdminBackgroundJobStatusCounts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    total,
  };

  for (const group of statusGroups) {
    statusCounts[group.status] = group._count.status;
  }

  return {
    items: pageItems,
    nextCursor,
    availableKinds: kindRows.map((row) => row.kind),
    statusCounts,
  };
};
