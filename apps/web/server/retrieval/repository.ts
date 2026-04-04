import { getPrisma } from "@staaash/db/client";

import {
  prismaLibraryRepository,
  type LibraryRepository,
} from "@/server/library/repository";

import type {
  FavoriteFileRecord,
  FavoriteFolderRecord,
  RecentFileRecord,
  RecentFolderRecord,
  RetrievalRepository,
} from "./types";

type RetrievalPrismaClient = Pick<
  ReturnType<typeof getPrisma>,
  "favoriteFile" | "favoriteFolder" | "recentFile" | "recentFolder"
>;

type CreatePrismaRetrievalRepositoryOptions = {
  client?: RetrievalPrismaClient;
  libraryRepo?: LibraryRepository;
};

export const createPrismaRetrievalRepository = ({
  client,
  libraryRepo,
}: CreatePrismaRetrievalRepositoryOptions = {}): RetrievalRepository => {
  const getClient = () =>
    client ?? (getPrisma() as unknown as RetrievalPrismaClient);
  const getLibraryRepo = () => libraryRepo ?? prismaLibraryRepository;

  return {
    ensureLibraryRoot(ownerUserId) {
      return getLibraryRepo().ensureLibraryRoot(ownerUserId);
    },

    findFolderById(folderId) {
      return getLibraryRepo().findFolderById(folderId);
    },

    findFileById(fileId) {
      return getLibraryRepo().findFileById(fileId);
    },

    listFoldersByOwner(ownerUserId) {
      return getLibraryRepo().listFoldersByOwner(ownerUserId, {
        includeDeleted: false,
      });
    },

    listFilesByOwner(ownerUserId) {
      return getLibraryRepo().listFilesByOwner(ownerUserId, {
        includeDeleted: false,
      });
    },

    async listFavoriteFiles(userId) {
      const client = getClient();
      const favorites = await client.favoriteFile.findMany({
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
      const client = getClient();
      const favorites = await client.favoriteFolder.findMany({
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
      const client = getClient();
      const recents = await client.recentFile.findMany({
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
      const client = getClient();
      const recents = await client.recentFolder.findMany({
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
      const client = getClient();

      await client.favoriteFile.upsert({
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
      const client = getClient();

      await client.favoriteFile.deleteMany({
        where: {
          userId,
          fileId,
        },
      });
    },

    async upsertFolderFavorite({ userId, folderId, createdAt }) {
      const client = getClient();

      await client.favoriteFolder.upsert({
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
      const client = getClient();

      await client.favoriteFolder.deleteMany({
        where: {
          userId,
          folderId,
        },
      });
    },

    async upsertRecentFile({ userId, fileId, lastInteractedAt }) {
      const client = getClient();

      await client.recentFile.upsert({
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
      const client = getClient();

      await client.recentFolder.upsert({
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
};

export const prismaRetrievalRepository = createPrismaRetrievalRepository();
