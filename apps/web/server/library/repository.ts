import { Prisma, prisma } from "@staaash/db/client";

import type { LibraryFolderSummary } from "@/server/library/types";

const libraryFolderSelect = {
  id: true,
  ownerUserId: true,
  parentId: true,
  name: true,
  isLibraryRoot: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FolderSelect;

const rootRepairSelect = {
  ...libraryFolderSelect,
  libraryRootKey: true,
} satisfies Prisma.FolderSelect;

type LibraryFolderRecord = Prisma.FolderGetPayload<{
  select: typeof libraryFolderSelect;
}>;

type RootRepairRecord = Prisma.FolderGetPayload<{
  select: typeof rootRepairSelect;
}>;

type ListFoldersOptions = {
  includeDeleted?: boolean;
};

type CreateFolderParams = {
  ownerUserId: string;
  parentId: string | null;
  name: string;
  isLibraryRoot?: boolean;
};

type UpdateFolderParams = {
  id: string;
  name?: string;
  parentId?: string | null;
  deletedAt?: Date | null;
};

type UpdateFoldersParams = {
  ids: string[];
  deletedAt: Date | null;
};

type FolderDelegate = {
  findFirst(args: Prisma.FolderFindFirstArgs): Promise<RootRepairRecord | null>;
  findUnique(
    args: Prisma.FolderFindUniqueArgs,
  ): Promise<LibraryFolderRecord | null>;
  findMany(args: Prisma.FolderFindManyArgs): Promise<RootRepairRecord[]>;
  create(args: Prisma.FolderCreateArgs): Promise<LibraryFolderRecord>;
  update(args: Prisma.FolderUpdateArgs): Promise<LibraryFolderRecord>;
  updateMany(args: Prisma.FolderUpdateManyArgs): Promise<unknown>;
};

type LibraryTransactionClient = {
  folder: FolderDelegate;
};

type LibraryPrismaClient = LibraryTransactionClient & {
  $transaction<T>(fn: (tx: LibraryTransactionClient) => Promise<T>): Promise<T>;
};

const toLibraryFolderSummary = (
  folder: Pick<
    RootRepairRecord,
    | "id"
    | "ownerUserId"
    | "parentId"
    | "name"
    | "isLibraryRoot"
    | "deletedAt"
    | "createdAt"
    | "updatedAt"
  >,
): LibraryFolderSummary => ({
  id: folder.id,
  ownerUserId: folder.ownerUserId,
  parentId: folder.parentId,
  name: folder.name,
  isLibraryRoot: folder.isLibraryRoot,
  deletedAt: folder.deletedAt,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

const isUniqueConstraintError = (error: unknown) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  return error.code === "P2002";
};

const sortLegacyRoots = (folders: RootRepairRecord[]) =>
  [...folders].sort((left, right) => {
    const leftDeletedRank = left.deletedAt ? 1 : 0;
    const rightDeletedRank = right.deletedAt ? 1 : 0;

    return (
      leftDeletedRank - rightDeletedRank ||
      left.createdAt.getTime() - right.createdAt.getTime() ||
      left.id.localeCompare(right.id)
    );
  });

const findCanonicalRoot = async (
  client: LibraryTransactionClient,
  ownerUserId: string,
) => {
  const folder = await client.folder.findFirst({
    where: {
      libraryRootKey: ownerUserId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: rootRepairSelect,
  });

  return folder ? toLibraryFolderSummary(folder) : null;
};

const listLegacyRoots = (
  client: LibraryTransactionClient,
  ownerUserId: string,
) =>
  client.folder.findMany({
    where: {
      ownerUserId,
      isLibraryRoot: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: rootRepairSelect,
  });

const createCanonicalRoot = async (
  client: LibraryTransactionClient,
  ownerUserId: string,
) => {
  const folder = await client.folder.create({
    data: {
      ownerUserId,
      libraryRootKey: ownerUserId,
      parentId: null,
      name: "Library",
      isLibraryRoot: true,
    },
    select: libraryFolderSelect,
  });

  return toLibraryFolderSummary(folder);
};

export type LibraryRepository = {
  ensureLibraryRoot(ownerUserId: string): Promise<LibraryFolderSummary>;
  findFolderById(folderId: string): Promise<LibraryFolderSummary | null>;
  listChildFolders(
    ownerUserId: string,
    parentId: string,
    options?: ListFoldersOptions,
  ): Promise<LibraryFolderSummary[]>;
  listFoldersByOwner(
    ownerUserId: string,
    options?: ListFoldersOptions,
  ): Promise<LibraryFolderSummary[]>;
  createFolder(params: CreateFolderParams): Promise<LibraryFolderSummary>;
  updateFolder(params: UpdateFolderParams): Promise<LibraryFolderSummary>;
  updateFolders(params: UpdateFoldersParams): Promise<void>;
};

export const createPrismaLibraryRepository = (
  client: LibraryPrismaClient = prisma as unknown as LibraryPrismaClient,
): LibraryRepository => ({
  async ensureLibraryRoot(ownerUserId) {
    const existingRoot = await findCanonicalRoot(client, ownerUserId);

    if (existingRoot) {
      return existingRoot;
    }

    try {
      return await client.$transaction(async (tx) => {
        const canonicalRoot = await findCanonicalRoot(tx, ownerUserId);

        if (canonicalRoot) {
          return canonicalRoot;
        }

        const legacyRoots = sortLegacyRoots(
          await listLegacyRoots(tx, ownerUserId),
        );

        if (legacyRoots.length === 0) {
          return createCanonicalRoot(tx, ownerUserId);
        }

        const [legacyCanonicalRoot, ...duplicateRoots] = legacyRoots;
        const repairedCanonicalRoot = await tx.folder.update({
          where: {
            id: legacyCanonicalRoot.id,
          },
          data: {
            libraryRootKey: ownerUserId,
            isLibraryRoot: true,
            parentId: null,
            deletedAt: null,
          },
          select: libraryFolderSelect,
        });

        for (const duplicateRoot of duplicateRoots) {
          await tx.folder.update({
            where: {
              id: duplicateRoot.id,
            },
            data: {
              libraryRootKey: null,
              isLibraryRoot: false,
              parentId: repairedCanonicalRoot.id,
            },
            select: libraryFolderSelect,
          });
        }

        return toLibraryFolderSummary(repairedCanonicalRoot);
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const canonicalRoot = await findCanonicalRoot(client, ownerUserId);

        if (canonicalRoot) {
          return canonicalRoot;
        }
      }

      throw error;
    }
  },

  async findFolderById(folderId) {
    const folder = await client.folder.findUnique({
      where: {
        id: folderId,
      },
      select: libraryFolderSelect,
    });

    return folder ? toLibraryFolderSummary(folder) : null;
  },

  async listChildFolders(ownerUserId, parentId, options = {}) {
    const folders = await client.folder.findMany({
      where: {
        ownerUserId,
        parentId,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: rootRepairSelect,
    });

    return folders.map(toLibraryFolderSummary);
  },

  async listFoldersByOwner(ownerUserId, options = {}) {
    const folders = await client.folder.findMany({
      where: {
        ownerUserId,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [
        { isLibraryRoot: "desc" },
        { parentId: "asc" },
        { name: "asc" },
        { createdAt: "asc" },
      ],
      select: rootRepairSelect,
    });

    return folders.map(toLibraryFolderSummary);
  },

  async createFolder(params) {
    const folder = await client.folder.create({
      data: {
        ownerUserId: params.ownerUserId,
        parentId: params.parentId,
        name: params.name,
        isLibraryRoot: params.isLibraryRoot ?? false,
      },
      select: libraryFolderSelect,
    });

    return toLibraryFolderSummary(folder);
  },

  async updateFolder(params) {
    const data: Prisma.FolderUncheckedUpdateInput = {};

    if ("name" in params) {
      data.name = params.name;
    }

    if ("parentId" in params) {
      data.parentId = params.parentId;
    }

    if ("deletedAt" in params) {
      data.deletedAt = params.deletedAt;
    }

    const folder = await client.folder.update({
      where: {
        id: params.id,
      },
      data,
      select: libraryFolderSelect,
    });

    return toLibraryFolderSummary(folder);
  },

  async updateFolders(params) {
    if (params.ids.length === 0) {
      return;
    }

    await client.folder.updateMany({
      where: {
        id: {
          in: params.ids,
        },
      },
      data: {
        deletedAt: params.deletedAt,
      },
    });
  },
});

export const prismaLibraryRepository = createPrismaLibraryRepository();
