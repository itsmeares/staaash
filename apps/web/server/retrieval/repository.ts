import { getPrisma } from "@staaash/db/client";

import {
  prismaFilesRepository,
  type FilesRepository,
} from "@/server/files/repository";

import type { RetrievalRepository } from "./types";

type RetrievalPrismaClient = Pick<
  ReturnType<typeof getPrisma>,
  "favoriteFile" | "favoriteFolder" | "recentFile" | "recentFolder"
>;

type CreatePrismaRetrievalRepositoryOptions = {
  client?: RetrievalPrismaClient;
  filesRepo?: FilesRepository;
};

const createPrismaRetrievalRepository = ({
  client,
  filesRepo,
}: CreatePrismaRetrievalRepositoryOptions = {}): RetrievalRepository => {
  const getClient = () =>
    client ?? (getPrisma() as unknown as RetrievalPrismaClient);
  const getFilesRepo = () => filesRepo ?? prismaFilesRepository;

  return {
    findFolderById(folderId) {
      return getFilesRepo().findFolderById(folderId);
    },

    findFileById(fileId) {
      return getFilesRepo().findFileById(fileId);
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
          quickAccessPinnedAt: null,
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

    async updateFileFavoriteQuickAccess({
      userId,
      fileId,
      quickAccessPinnedAt,
    }) {
      const client = getClient();

      const result = await client.favoriteFile.updateMany({
        where: {
          userId,
          fileId,
        },
        data: {
          quickAccessPinnedAt,
        },
      });

      return result.count > 0;
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
          quickAccessPinnedAt: null,
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

    async updateFolderFavoriteQuickAccess({
      userId,
      folderId,
      quickAccessPinnedAt,
    }) {
      const client = getClient();

      const result = await client.favoriteFolder.updateMany({
        where: {
          userId,
          folderId,
        },
        data: {
          quickAccessPinnedAt,
        },
      });

      return result.count > 0;
    },

    async upsertRecentFile({ userId, fileId, lastInteractedAt, lastAction }) {
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
          lastAction,
        },
        update: {
          lastInteractedAt,
          lastAction,
        },
      });
    },

    async upsertRecentFolder({
      userId,
      folderId,
      lastInteractedAt,
      lastAction,
    }) {
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
          lastAction,
        },
        update: {
          lastInteractedAt,
          lastAction,
        },
      });
    },
  };
};

export const prismaRetrievalRepository = createPrismaRetrievalRepository();
