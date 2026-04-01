import { Prisma, prisma } from "@staaash/db/client";

import type {
  LibraryFolderSummary,
  StoredLibraryFile,
} from "@/server/library/types";

const libraryFolderSelect = {
  id: true,
  ownerUserId: true,
  owner: {
    select: {
      username: true,
    },
  },
  parentId: true,
  name: true,
  isLibraryRoot: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FolderSelect;

const libraryFileSelect = {
  id: true,
  ownerUserId: true,
  owner: {
    select: {
      username: true,
    },
  },
  folderId: true,
  originalName: true,
  storageKey: true,
  mimeType: true,
  sizeBytes: true,
  contentChecksum: true,
  previewStatus: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FileSelect;

type LibraryFolderRecord = Prisma.FolderGetPayload<{
  select: typeof libraryFolderSelect;
}>;

type LibraryFileRecord = Prisma.FileGetPayload<{
  select: typeof libraryFileSelect;
}>;

type ListFoldersOptions = {
  includeDeleted?: boolean;
};

type ListFilesOptions = {
  includeDeleted?: boolean;
};

type CreateFolderParams = {
  ownerUserId: string;
  parentId: string | null;
  name: string;
  isLibraryRoot?: boolean;
};

type CreateFileParams = {
  id?: string;
  ownerUserId: string;
  folderId: string | null;
  name: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  contentChecksum: string | null;
};

type UpdateFolderParams = {
  id: string;
  name?: string;
  parentId?: string | null;
  deletedAt?: Date | null;
};

type UpdateFileParams = {
  id: string;
  name?: string;
  folderId?: string | null;
  storageKey?: string;
  mimeType?: string;
  sizeBytes?: number;
  contentChecksum?: string | null;
  deletedAt?: Date | null;
};

type UpdateFoldersParams = {
  ids: string[];
  deletedAt: Date | null;
};

type UpdateFilesParams = {
  ids: string[];
  deletedAt: Date | null;
};

type FolderDelegate = {
  findFirst(
    args: Prisma.FolderFindFirstArgs,
  ): Promise<LibraryFolderRecord | null>;
  findUnique(
    args: Prisma.FolderFindUniqueArgs,
  ): Promise<LibraryFolderRecord | null>;
  findMany(args: Prisma.FolderFindManyArgs): Promise<LibraryFolderRecord[]>;
  create(args: Prisma.FolderCreateArgs): Promise<LibraryFolderRecord>;
  update(args: Prisma.FolderUpdateArgs): Promise<LibraryFolderRecord>;
  updateMany(args: Prisma.FolderUpdateManyArgs): Promise<unknown>;
};

type FileDelegate = {
  findUnique(
    args: Prisma.FileFindUniqueArgs,
  ): Promise<LibraryFileRecord | null>;
  findMany(args: Prisma.FileFindManyArgs): Promise<LibraryFileRecord[]>;
  create(args: Prisma.FileCreateArgs): Promise<LibraryFileRecord>;
  update(args: Prisma.FileUpdateArgs): Promise<LibraryFileRecord>;
  updateMany(args: Prisma.FileUpdateManyArgs): Promise<unknown>;
  delete(args: Prisma.FileDeleteArgs): Promise<unknown>;
};

type LibraryTransactionClient = {
  folder: FolderDelegate;
  file: FileDelegate;
};

type LibraryPrismaClient = LibraryTransactionClient & {
  $transaction<T>(fn: (tx: LibraryTransactionClient) => Promise<T>): Promise<T>;
};

const toLibraryFolderSummary = (
  folder: Pick<
    LibraryFolderRecord,
    | "id"
    | "ownerUserId"
    | "owner"
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
  ownerUsername: folder.owner.username,
  parentId: folder.parentId,
  name: folder.name,
  isLibraryRoot: folder.isLibraryRoot,
  deletedAt: folder.deletedAt,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

const toStoredLibraryFile = (file: LibraryFileRecord): StoredLibraryFile => ({
  id: file.id,
  ownerUserId: file.ownerUserId,
  ownerUsername: file.owner.username,
  folderId: file.folderId,
  name: file.originalName,
  storageKey: file.storageKey,
  mimeType: file.mimeType,
  sizeBytes: Number(file.sizeBytes),
  contentChecksum: file.contentChecksum,
  previewStatus: file.previewStatus,
  deletedAt: file.deletedAt,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const sortLegacyRoots = (folders: LibraryFolderRecord[]) =>
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
      ownerUserId,
      isLibraryRoot: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: libraryFolderSelect,
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
    select: libraryFolderSelect,
  });

const createCanonicalRoot = async (
  client: LibraryTransactionClient,
  ownerUserId: string,
) => {
  const folder = await client.folder.create({
    data: {
      ownerUserId,
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
  findFileById(fileId: string): Promise<StoredLibraryFile | null>;
  listChildFolders(
    ownerUserId: string,
    parentId: string,
    options?: ListFoldersOptions,
  ): Promise<LibraryFolderSummary[]>;
  listChildFiles(
    ownerUserId: string,
    folderId: string | null,
    options?: ListFilesOptions,
  ): Promise<StoredLibraryFile[]>;
  listFoldersByOwner(
    ownerUserId: string,
    options?: ListFoldersOptions,
  ): Promise<LibraryFolderSummary[]>;
  listFilesByOwner(
    ownerUserId: string,
    options?: ListFilesOptions,
  ): Promise<StoredLibraryFile[]>;
  createFolder(params: CreateFolderParams): Promise<LibraryFolderSummary>;
  createFile(params: CreateFileParams): Promise<StoredLibraryFile>;
  updateFolder(params: UpdateFolderParams): Promise<LibraryFolderSummary>;
  updateFile(params: UpdateFileParams): Promise<StoredLibraryFile>;
  updateFolders(params: UpdateFoldersParams): Promise<void>;
  updateFiles(params: UpdateFilesParams): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
};

export const createPrismaLibraryRepository = (
  client: LibraryPrismaClient = prisma as unknown as LibraryPrismaClient,
): LibraryRepository => ({
  async ensureLibraryRoot(ownerUserId) {
    const existingRoots = sortLegacyRoots(
      await listLegacyRoots(client, ownerUserId),
    );

    if (existingRoots.length === 1) {
      return toLibraryFolderSummary(existingRoots[0]);
    }

    try {
      return await client.$transaction(async (tx) => {
        const legacyRoots = sortLegacyRoots(
          await listLegacyRoots(tx, ownerUserId),
        );

        if (legacyRoots.length === 0) {
          return createCanonicalRoot(tx, ownerUserId);
        }

        if (legacyRoots.length === 1) {
          return toLibraryFolderSummary(legacyRoots[0]);
        }

        const [legacyCanonicalRoot, ...duplicateRoots] = legacyRoots;
        const repairedCanonicalRoot = await tx.folder.update({
          where: {
            id: legacyCanonicalRoot.id,
          },
          data: {
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
              isLibraryRoot: false,
              parentId: repairedCanonicalRoot.id,
            },
            select: libraryFolderSelect,
          });
        }

        return toLibraryFolderSummary(repairedCanonicalRoot);
      });
    } catch (error) {
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

  async findFileById(fileId) {
    const file = await client.file.findUnique({
      where: {
        id: fileId,
      },
      select: libraryFileSelect,
    });

    return file ? toStoredLibraryFile(file) : null;
  },

  async listChildFolders(ownerUserId, parentId, options = {}) {
    const folders = await client.folder.findMany({
      where: {
        ownerUserId,
        parentId,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [{ name: "asc" }, { createdAt: "asc" }],
      select: libraryFolderSelect,
    });

    return folders.map(toLibraryFolderSummary);
  },

  async listChildFiles(ownerUserId, folderId, options = {}) {
    const files = await client.file.findMany({
      where: {
        ownerUserId,
        folderId,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [{ originalName: "asc" }, { createdAt: "asc" }],
      select: libraryFileSelect,
    });

    return files.map(toStoredLibraryFile);
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
      select: libraryFolderSelect,
    });

    return folders.map(toLibraryFolderSummary);
  },

  async listFilesByOwner(ownerUserId, options = {}) {
    const files = await client.file.findMany({
      where: {
        ownerUserId,
        ...(options.includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [
        { folderId: "asc" },
        { originalName: "asc" },
        { createdAt: "asc" },
      ],
      select: libraryFileSelect,
    });

    return files.map(toStoredLibraryFile);
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

  async createFile(params) {
    const file = await client.file.create({
      data: {
        id: params.id,
        ownerUserId: params.ownerUserId,
        folderId: params.folderId,
        originalName: params.name,
        storageKey: params.storageKey,
        mimeType: params.mimeType,
        sizeBytes: BigInt(params.sizeBytes),
        contentChecksum: params.contentChecksum,
      },
      select: libraryFileSelect,
    });

    return toStoredLibraryFile(file);
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

  async updateFile(params) {
    const data: Prisma.FileUncheckedUpdateInput = {};

    if ("name" in params) {
      data.originalName = params.name;
    }

    if ("folderId" in params) {
      data.folderId = params.folderId;
    }

    if ("storageKey" in params) {
      data.storageKey = params.storageKey;
    }

    if ("mimeType" in params) {
      data.mimeType = params.mimeType;
    }

    if ("sizeBytes" in params && params.sizeBytes !== undefined) {
      data.sizeBytes = BigInt(params.sizeBytes);
    }

    if ("contentChecksum" in params) {
      data.contentChecksum = params.contentChecksum;
    }

    if ("deletedAt" in params) {
      data.deletedAt = params.deletedAt;
    }

    const file = await client.file.update({
      where: {
        id: params.id,
      },
      data,
      select: libraryFileSelect,
    });

    return toStoredLibraryFile(file);
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

  async updateFiles(params) {
    if (params.ids.length === 0) {
      return;
    }

    await client.file.updateMany({
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

  async deleteFile(fileId) {
    await client.file.delete({
      where: {
        id: fileId,
      },
    });
  },
});

export const prismaLibraryRepository = createPrismaLibraryRepository();
