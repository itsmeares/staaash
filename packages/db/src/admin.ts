import { getPrisma } from "./client";
import type { BackgroundJobRecord } from "./jobs";

type UserRecord = {
  id: string;
  email: string;
  storageId: string;
  displayName: string | null;
  isOwner: boolean;
  isAdmin: boolean;
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
  storageId: string;
  displayName: string | null;
  isOwner: boolean;
  isAdmin: boolean;
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
  status?:
    BackgroundJobRecord["status"] | BackgroundJobRecord["status"][] | null;
  kind?: string | null;
  limit?: number;
  cursor?: string | null;
  page?: number | null;
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
  page: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
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
        storageId: true,
        displayName: true,
        isOwner: true,
        isAdmin: true,
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
        isFilesRoot: false,
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
      storageId: user.storageId,
      displayName: user.displayName,
      isOwner: user.isOwner,
      isAdmin: user.isAdmin,
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

const normalizeJobListPage = (value: number | null | undefined) => {
  if (!value) {
    return 1;
  }

  return Math.max(value, 1);
};

const buildJobWhere = ({
  status,
  kind,
}: Pick<AdminBackgroundJobListFilters, "status" | "kind">) => ({
  ...(Array.isArray(status)
    ? status.length > 0
      ? { status: { in: status } }
      : {}
    : status
      ? { status }
      : {}),
  ...(kind ? { kind } : {}),
});

export const listAdminBackgroundJobs = async (
  filters: AdminBackgroundJobListFilters = {},
  client?: AdminClient,
): Promise<AdminBackgroundJobListResult> => {
  const activeClient = client ?? (getPrisma() as unknown as AdminClient);
  const limit = normalizeJobListLimit(filters.limit);
  const requestedPage = normalizeJobListPage(filters.page);
  const where = buildJobWhere(filters);

  const [kindRows, statusGroups, totalCount, statusTotal] = await Promise.all([
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
    activeClient.backgroundJob.count({ where }),
    activeClient.backgroundJob.count(),
  ]);

  const pageCount = Math.ceil(totalCount / limit);
  const page = filters.cursor
    ? requestedPage
    : Math.min(requestedPage, Math.max(pageCount, 1));
  const items = (await activeClient.backgroundJob.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: filters.cursor ? limit + 1 : limit,
    ...(filters.cursor
      ? {
          cursor: {
            id: filters.cursor,
          },
          skip: 1,
        }
      : {
          skip: (page - 1) * limit,
        }),
  })) as BackgroundJobRecord[];

  const pageItems = filters.cursor ? items.slice(0, limit) : items;
  const hasPreviousPage = filters.cursor ? false : page > 1;
  const hasNextPage = filters.cursor ? items.length > limit : page < pageCount;
  const nextCursor =
    hasNextPage && pageItems.length > 0
      ? pageItems[pageItems.length - 1]!.id
      : null;

  const statusCounts: AdminBackgroundJobStatusCounts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
    cancelled: 0,
    total: statusTotal,
  };

  for (const group of statusGroups) {
    statusCounts[group.status] = group._count.status;
  }

  return {
    items: pageItems,
    nextCursor,
    page,
    pageCount,
    pageSize: limit,
    totalCount,
    hasNextPage,
    hasPreviousPage,
    availableKinds: kindRows.map((row) => row.kind),
    statusCounts,
  };
};

export const listAdminBackgroundJobItems = async (
  filters: Pick<AdminBackgroundJobListFilters, "kind" | "limit"> = {},
  client?: AdminClient,
): Promise<BackgroundJobRecord[]> => {
  const activeClient = client ?? (getPrisma() as unknown as AdminClient);
  const limit = normalizeJobListLimit(filters.limit);

  return activeClient.backgroundJob.findMany({
    where: buildJobWhere({ kind: filters.kind, status: null }),
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  }) as Promise<BackgroundJobRecord[]>;
};
