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

type LibraryFolderRecord = Prisma.FolderGetPayload<{
  select: typeof libraryFolderSelect;
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

const toLibraryFolderSummary = (
  folder: LibraryFolderRecord,
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

export type LibraryRepository = {
  findLibraryRootByOwnerUserId(
    ownerUserId: string,
  ): Promise<LibraryFolderSummary | null>;
  createLibraryRoot(ownerUserId: string): Promise<LibraryFolderSummary>;
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

export const prismaLibraryRepository: LibraryRepository = {
  async findLibraryRootByOwnerUserId(ownerUserId) {
    const folder = await prisma.folder.findFirst({
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
  },

  async createLibraryRoot(ownerUserId) {
    const folder = await prisma.folder.create({
      data: {
        ownerUserId,
        parentId: null,
        name: "Library",
        isLibraryRoot: true,
      },
      select: libraryFolderSelect,
    });

    return toLibraryFolderSummary(folder);
  },

  async findFolderById(folderId) {
    const folder = await prisma.folder.findUnique({
      where: {
        id: folderId,
      },
      select: libraryFolderSelect,
    });

    return folder ? toLibraryFolderSummary(folder) : null;
  },

  async listChildFolders(ownerUserId, parentId, options = {}) {
    const folders = await prisma.folder.findMany({
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

  async listFoldersByOwner(ownerUserId, options = {}) {
    const folders = await prisma.folder.findMany({
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

  async createFolder(params) {
    const folder = await prisma.folder.create({
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

    const folder = await prisma.folder.update({
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

    await prisma.folder.updateMany({
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
};
