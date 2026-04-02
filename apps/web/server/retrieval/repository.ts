import { prisma } from "@staaash/db/client";

import { prismaLibraryRepository } from "@/server/library/repository";

import type {
  FavoriteFileRecord,
  FavoriteFolderRecord,
  RecentFileRecord,
  RecentFolderRecord,
  RetrievalRepository,
} from "./types";

export const prismaRetrievalRepository: RetrievalRepository = {
  ensureLibraryRoot(ownerUserId) {
    return prismaLibraryRepository.ensureLibraryRoot(ownerUserId);
  },

  findFolderById(folderId) {
    return prismaLibraryRepository.findFolderById(folderId);
  },

  findFileById(fileId) {
    return prismaLibraryRepository.findFileById(fileId);
  },

  listFoldersByOwner(ownerUserId) {
    return prismaLibraryRepository.listFoldersByOwner(ownerUserId, {
      includeDeleted: false,
    });
  },

  listFilesByOwner(ownerUserId) {
    return prismaLibraryRepository.listFilesByOwner(ownerUserId, {
      includeDeleted: false,
    });
  },

  async listFavoriteFiles(userId) {
    const favorites = await prisma.favoriteFile.findMany({
      where: {
        userId,
      },
      orderBy: [{ createdAt: "desc" }, { fileId: "asc" }],
    });

    return favorites.map(
      (favorite): FavoriteFileRecord => ({
        userId: favorite.userId,
        fileId: favorite.fileId,
        createdAt: favorite.createdAt,
      }),
    );
  },

  async listFavoriteFolders(userId) {
    const favorites = await prisma.favoriteFolder.findMany({
      where: {
        userId,
      },
      orderBy: [{ createdAt: "desc" }, { folderId: "asc" }],
    });

    return favorites.map(
      (favorite): FavoriteFolderRecord => ({
        userId: favorite.userId,
        folderId: favorite.folderId,
        createdAt: favorite.createdAt,
      }),
    );
  },

  async listRecentFiles(userId) {
    const recents = await prisma.recentFile.findMany({
      where: {
        userId,
      },
      orderBy: [{ lastInteractedAt: "desc" }, { fileId: "asc" }],
    });

    return recents.map(
      (recent): RecentFileRecord => ({
        userId: recent.userId,
        fileId: recent.fileId,
        lastInteractedAt: recent.lastInteractedAt,
      }),
    );
  },

  async listRecentFolders(userId) {
    const recents = await prisma.recentFolder.findMany({
      where: {
        userId,
      },
      orderBy: [{ lastInteractedAt: "desc" }, { folderId: "asc" }],
    });

    return recents.map(
      (recent): RecentFolderRecord => ({
        userId: recent.userId,
        folderId: recent.folderId,
        lastInteractedAt: recent.lastInteractedAt,
      }),
    );
  },

  async upsertFileFavorite({ userId, fileId, createdAt }) {
    await prisma.favoriteFile.upsert({
      where: {
        userId_fileId: {
          userId,
          fileId,
        },
      },
      create: {
        userId,
        fileId,
        createdAt,
      },
      update: {},
    });
  },

  async deleteFileFavorite({ userId, fileId }) {
    await prisma.favoriteFile.deleteMany({
      where: {
        userId,
        fileId,
      },
    });
  },

  async upsertFolderFavorite({ userId, folderId, createdAt }) {
    await prisma.favoriteFolder.upsert({
      where: {
        userId_folderId: {
          userId,
          folderId,
        },
      },
      create: {
        userId,
        folderId,
        createdAt,
      },
      update: {},
    });
  },

  async deleteFolderFavorite({ userId, folderId }) {
    await prisma.favoriteFolder.deleteMany({
      where: {
        userId,
        folderId,
      },
    });
  },

  async upsertRecentFile({ userId, fileId, lastInteractedAt }) {
    await prisma.recentFile.upsert({
      where: {
        userId_fileId: {
          userId,
          fileId,
        },
      },
      create: {
        userId,
        fileId,
        lastInteractedAt,
      },
      update: {
        lastInteractedAt,
      },
    });
  },

  async upsertRecentFolder({ userId, folderId, lastInteractedAt }) {
    await prisma.recentFolder.upsert({
      where: {
        userId_folderId: {
          userId,
          folderId,
        },
      },
      create: {
        userId,
        folderId,
        lastInteractedAt,
      },
      update: {
        lastInteractedAt,
      },
    });
  },
};
