import { Prisma, getPrisma } from "@staaash/db/client";
import { resolveViewerKind } from "@staaash/db/viewer-contract";

import type { FolderSummary, StoredFile } from "@/server/files/types";

const folderSelect = {
  id: true,
  ownerUserId: true,
  owner: {
    select: {
      username: true,
    },
  },
  parentId: true,
  name: true,
  isFilesRoot: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FolderSelect;

const fileSelect = {
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
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FileSelect;

type FolderRecord = Prisma.FolderGetPayload<{
  select: typeof folderSelect;
}>;

type FileRecord = Prisma.FileGetPayload<{
  select: typeof fileSelect;
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
  isFilesRoot?: boolean;
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
  findFirst(args: Prisma.FolderFindFirstArgs): Promise<FolderRecord | null>;
  findUnique(args: Prisma.FolderFindUniqueArgs): Promise<FolderRecord | null>;
  findMany(args: Prisma.FolderFindManyArgs): Promise<FolderRecord[]>;
  create(args: Prisma.FolderCreateArgs): Promise<FolderRecord>;
  update(args: Prisma.FolderUpdateArgs): Promise<FolderRecord>;
  updateMany(args: Prisma.FolderUpdateManyArgs): Promise<unknown>;
  deleteMany(args: Prisma.FolderDeleteManyArgs): Promise<unknown>;
};

type FileDelegate = {
  findUnique(args: Prisma.FileFindUniqueArgs): Promise<FileRecord | null>;
  findMany(args: Prisma.FileFindManyArgs): Promise<FileRecord[]>;
  create(args: Prisma.FileCreateArgs): Promise<FileRecord>;
  update(args: Prisma.FileUpdateArgs): Promise<FileRecord>;
  updateMany(args: Prisma.FileUpdateManyArgs): Promise<unknown>;
  delete(args: Prisma.FileDeleteArgs): Promise<unknown>;
  deleteMany(args: Prisma.FileDeleteManyArgs): Promise<unknown>;
};

type DeleteManyResult = {
  count: number;
};

type FilesTransactionClient = {
  folder: FolderDelegate;
  file: FileDelegate;
};

type FilesPrismaClient = FilesTransactionClient & {
  $transaction<T>(fn: (tx: FilesTransactionClient) => Promise<T>): Promise<T>;
};

const toFolderSummary = (
  folder: Pick<
    FolderRecord,
    | "id"
    | "ownerUserId"
    | "owner"
    | "parentId"
    | "name"
    | "isFilesRoot"
    | "deletedAt"
    | "createdAt"
    | "updatedAt"
  >,
): FolderSummary => ({
  id: folder.id,
  ownerUserId: folder.ownerUserId,
  ownerUsername: folder.owner.username,
  parentId: folder.parentId,
  name: folder.name,
  isFilesRoot: folder.isFilesRoot,
  deletedAt: folder.deletedAt,
  createdAt: folder.createdAt,
  updatedAt: folder.updatedAt,
});

const toStoredFile = (file: FileRecord): StoredFile => ({
  id: file.id,
  ownerUserId: file.ownerUserId,
  ownerUsername: file.owner.username,
  folderId: file.folderId,
  name: file.originalName,
  storageKey: file.storageKey,
  mimeType: file.mimeType,
  sizeBytes: Number(file.sizeBytes),
  contentChecksum: file.contentChecksum,
  viewerKind: resolveViewerKind(file.mimeType),
  deletedAt: file.deletedAt,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const sortLegacyRoots = (folders: FolderRecord[]) =>
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
  client: FilesTransactionClient,
  ownerUserId: string,
) => {
  const folder = await client.folder.findFirst({
    where: {
      ownerUserId,
      isFilesRoot: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: folderSelect,
  });

  return folder ? toFolderSummary(folder) : null;
};

const listLegacyRoots = (client: FilesTransactionClient, ownerUserId: string) =>
  client.folder.findMany({
    where: {
      ownerUserId,
      isFilesRoot: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: folderSelect,
  });

const createCanonicalRoot = async (
  client: FilesTransactionClient,
  ownerUserId: string,
) => {
  const folder = await client.folder.create({
    data: {
      ownerUserId,
      parentId: null,
      name: "Files",
      isFilesRoot: true,
    },
    select: folderSelect,
  });

  return toFolderSummary(folder);
};

export type FilesRepository = {
  ensureFilesRoot(ownerUserId: string): Promise<FolderSummary>;
  findFolderById(folderId: string): Promise<FolderSummary | null>;
  findFileById(fileId: string): Promise<StoredFile | null>;
  listChildFolders(
    ownerUserId: string,
    parentId: string,
    options?: ListFoldersOptions,
  ): Promise<FolderSummary[]>;
  listChildFiles(
    ownerUserId: string,
    folderId: string | null,
    options?: ListFilesOptions,
  ): Promise<StoredFile[]>;
  listFoldersByOwner(
    ownerUserId: string,
    options?: ListFoldersOptions,
  ): Promise<FolderSummary[]>;
  listFilesByOwner(
    ownerUserId: string,
    options?: ListFilesOptions,
  ): Promise<StoredFile[]>;
  searchFilesByOwner(
    ownerUserId: string,
    nameQuery: string,
    folderIds: string[],
  ): Promise<StoredFile[]>;
  createFolder(params: CreateFolderParams): Promise<FolderSummary>;
  createFile(params: CreateFileParams): Promise<StoredFile>;
  updateFolder(params: UpdateFolderParams): Promise<FolderSummary>;
  updateFile(params: UpdateFileParams): Promise<StoredFile>;
  updateFolders(params: UpdateFoldersParams): Promise<void>;
  updateFiles(params: UpdateFilesParams): Promise<void>;
  deleteFile(fileId: string): Promise<void>;
  deleteFiles(fileIds: string[]): Promise<number>;
  deleteFolders(folderIds: string[]): Promise<number>;
};

export const createPrismaFilesRepository = (
  client?: FilesPrismaClient,
): FilesRepository => {
  const getClient = () =>
    client ?? (getPrisma() as unknown as FilesPrismaClient);

  return {
    async ensureFilesRoot(ownerUserId) {
      const client = getClient();
      const existingRoots = sortLegacyRoots(
        await listLegacyRoots(client, ownerUserId),
      );

      if (existingRoots.length === 1) {
        return toFolderSummary(existingRoots[0]);
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
            return toFolderSummary(legacyRoots[0]);
          }

          const [legacyCanonicalRoot, ...duplicateRoots] = legacyRoots;
          const repairedCanonicalRoot = await tx.folder.update({
            where: {
              id: legacyCanonicalRoot.id,
            },
            data: {
              isFilesRoot: true,
              parentId: null,
              deletedAt: null,
            },
            select: folderSelect,
          });

          for (const duplicateRoot of duplicateRoots) {
            await tx.folder.update({
              where: {
                id: duplicateRoot.id,
              },
              data: {
                isFilesRoot: false,
                parentId: repairedCanonicalRoot.id,
              },
              select: folderSelect,
            });
          }

          return toFolderSummary(repairedCanonicalRoot);
        });
      } catch (error) {
        throw error;
      }
    },

    async findFolderById(folderId) {
      const client = getClient();
      const folder = await client.folder.findUnique({
        where: {
          id: folderId,
        },
        select: folderSelect,
      });

      return folder ? toFolderSummary(folder) : null;
    },

    async findFileById(fileId) {
      const client = getClient();
      const file = await client.file.findUnique({
        where: {
          id: fileId,
        },
        select: fileSelect,
      });

      return file ? toStoredFile(file) : null;
    },

    async listChildFolders(ownerUserId, parentId, options = {}) {
      const client = getClient();
      const folders = await client.folder.findMany({
        where: {
          ownerUserId,
          parentId,
          ...(options.includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ name: "asc" }, { createdAt: "asc" }],
        select: folderSelect,
      });

      return folders.map(toFolderSummary);
    },

    async listChildFiles(ownerUserId, folderId, options = {}) {
      const client = getClient();
      const files = await client.file.findMany({
        where: {
          ownerUserId,
          folderId,
          ...(options.includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [{ originalName: "asc" }, { createdAt: "asc" }],
        select: fileSelect,
      });

      return files.map(toStoredFile);
    },

    async listFoldersByOwner(ownerUserId, options = {}) {
      const client = getClient();
      const folders = await client.folder.findMany({
        where: {
          ownerUserId,
          ...(options.includeDeleted ? {} : { deletedAt: null }),
        },
        orderBy: [
          { isFilesRoot: "desc" },
          { parentId: "asc" },
          { name: "asc" },
          { createdAt: "asc" },
        ],
        select: folderSelect,
      });

      return folders.map(toFolderSummary);
    },

    async listFilesByOwner(ownerUserId, options = {}) {
      const client = getClient();
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
        select: fileSelect,
      });

      return files.map(toStoredFile);
    },

    async searchFilesByOwner(ownerUserId, nameQuery, folderIds) {
      const trimmed = nameQuery.trim();

      if (trimmed.length === 0 && folderIds.length === 0) {
        return [];
      }

      const prisma = getPrisma();
      const matchingIds = new Set<string>();

      await Promise.all([
        trimmed.length > 0
          ? prisma.$queryRaw<{ id: string }[]>`
                SELECT id FROM "File"
                WHERE "ownerUserId" = ${ownerUserId}
                  AND "deletedAt" IS NULL
                  AND unaccent(lower("originalName")) LIKE '%' || unaccent(lower(${trimmed})) || '%'
              `.then((rows) => {
              for (const r of rows) matchingIds.add(r.id);
            })
          : Promise.resolve(),
        folderIds.length > 0
          ? prisma.file
              .findMany({
                where: {
                  ownerUserId,
                  deletedAt: null,
                  folderId: { in: folderIds },
                },
                select: { id: true },
              })
              .then((rows) => {
                for (const r of rows) matchingIds.add(r.id);
              })
          : Promise.resolve(),
      ]);

      if (matchingIds.size === 0) {
        return [];
      }

      const files = await prisma.file.findMany({
        where: { id: { in: [...matchingIds] } },
        select: fileSelect,
      });

      return files.map(toStoredFile);
    },

    async createFolder(params) {
      const client = getClient();
      const folder = await client.folder.create({
        data: {
          ownerUserId: params.ownerUserId,
          parentId: params.parentId,
          name: params.name,
          isFilesRoot: params.isFilesRoot ?? false,
        },
        select: folderSelect,
      });

      return toFolderSummary(folder);
    },

    async createFile(params) {
      const client = getClient();
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
        select: fileSelect,
      });

      return toStoredFile(file);
    },

    async updateFolder(params) {
      const client = getClient();
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
        select: folderSelect,
      });

      return toFolderSummary(folder);
    },

    async updateFile(params) {
      const client = getClient();
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
        select: fileSelect,
      });

      return toStoredFile(file);
    },

    async updateFolders(params) {
      if (params.ids.length === 0) {
        return;
      }

      const client = getClient();

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

      const client = getClient();

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
      const client = getClient();

      await client.file.delete({
        where: {
          id: fileId,
        },
      });
    },

    async deleteFiles(fileIds) {
      if (fileIds.length === 0) {
        return 0;
      }

      const client = getClient();
      const result = (await client.file.deleteMany({
        where: {
          id: {
            in: fileIds,
          },
        },
      })) as DeleteManyResult;

      return result.count;
    },

    async deleteFolders(folderIds) {
      if (folderIds.length === 0) {
        return 0;
      }

      const client = getClient();
      const result = (await client.folder.deleteMany({
        where: {
          id: {
            in: folderIds,
          },
        },
      })) as DeleteManyResult;

      return result.count;
    },
  };
};

export const prismaFilesRepository = createPrismaFilesRepository();
