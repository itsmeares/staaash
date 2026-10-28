// Retrieval variants intentionally share stable ordering and access guards.
// fallow-ignore-file code-duplication
import { canAccessPrivateNamespace } from "@/server/access";
import { FilesError } from "@/server/files/errors";
import type {
  FilesActor,
  FileSummary,
  FolderSummary,
} from "@/server/files/types";
import type {
  FavoriteMutationResult,
  RecentAction,
  RetrievalRepository,
} from "./types";

type CreateRetrievalServiceOptions = {
  repo?: RetrievalRepository;
  now?: () => Date;
};

type FileFavoriteInput = FilesActor & {
  fileId: string;
  isFavorite: boolean;
};

type FileQuickAccessInput = FilesActor & {
  fileId: string;
  quickAccessPinned: boolean;
};

type FolderFavoriteInput = FilesActor & {
  folderId: string;
  isFavorite: boolean;
};

type FolderQuickAccessInput = FilesActor & {
  folderId: string;
  quickAccessPinned: boolean;
};

type FileAccessInput = FilesActor & {
  fileId: string;
  action: RecentAction;
};

type FolderAccessInput = FilesActor & {
  folderId: string;
  action: RecentAction;
};

const assertFolderAccess = (
  actor: FilesActor,
  folder: FolderSummary | null,
) => {
  if (!folder) {
    throw new FilesError("FOLDER_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: actor.actorRole,
      actorUserId: actor.actorUserId,
      namespaceOwnerUserId: folder.ownerUserId,
    })
  ) {
    throw new FilesError("FOLDER_NOT_FOUND");
  }

  return folder;
};

const assertFileAccess = (actor: FilesActor, file: FileSummary | null) => {
  if (!file) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: actor.actorRole,
      actorUserId: actor.actorUserId,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  return file;
};

const assertActiveFolder = (folder: FolderSummary) => {
  if (folder.deletedAt) {
    throw new FilesError("FOLDER_NOT_FOUND");
  }

  return folder;
};

const assertActiveFile = (file: FileSummary) => {
  if (file.deletedAt) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  return file;
};

// Test-only dependency-injection seam.
// fallow-ignore-next-line unused-export
export const createRetrievalService = ({
  repo,
  now = () => new Date(),
}: CreateRetrievalServiceOptions = {}) => {
  const resolveRepo = async (): Promise<RetrievalRepository> =>
    repo ?? (await import("./repository")).prismaRetrievalRepository;

  return {
    async setFileFavorite({
      actorUserId,
      actorRole,
      fileId,
      isFavorite,
    }: FileFavoriteInput): Promise<FavoriteMutationResult> {
      const activeRepo = await resolveRepo();
      const file = assertActiveFile(
        assertFileAccess(
          {
            actorUserId,
            actorRole,
          },
          await activeRepo.findFileById(fileId),
        ),
      );

      if (isFavorite) {
        await activeRepo.upsertFileFavorite({
          userId: actorUserId,
          fileId: file.id,
          createdAt: now(),
        });
      } else {
        await activeRepo.deleteFileFavorite({
          userId: actorUserId,
          fileId: file.id,
        });
      }

      return {
        kind: "file",
        id: file.id,
        isFavorite,
        quickAccessPinnedAt: isFavorite ? undefined : null,
      };
    },

    async setFileFavoriteQuickAccess({
      actorUserId,
      actorRole,
      fileId,
      quickAccessPinned,
    }: FileQuickAccessInput): Promise<FavoriteMutationResult> {
      const activeRepo = await resolveRepo();
      const file = assertActiveFile(
        assertFileAccess(
          {
            actorUserId,
            actorRole,
          },
          await activeRepo.findFileById(fileId),
        ),
      );
      const quickAccessPinnedAt = quickAccessPinned ? now() : null;
      const updated = await activeRepo.updateFileFavoriteQuickAccess({
        userId: actorUserId,
        fileId: file.id,
        quickAccessPinnedAt,
      });

      if (!updated) {
        throw new FilesError("FILE_NOT_FOUND", "Favorite file does not exist.");
      }

      return {
        kind: "file",
        id: file.id,
        isFavorite: true,
        quickAccessPinnedAt,
      };
    },

    async setFolderFavorite({
      actorUserId,
      actorRole,
      folderId,
      isFavorite,
    }: FolderFavoriteInput): Promise<FavoriteMutationResult> {
      const activeRepo = await resolveRepo();
      const folder = assertActiveFolder(
        assertFolderAccess(
          {
            actorUserId,
            actorRole,
          },
          await activeRepo.findFolderById(folderId),
        ),
      );

      if (folder.isFilesRoot) {
        throw new FilesError("FOLDER_ROOT_IMMUTABLE");
      }

      if (isFavorite) {
        await activeRepo.upsertFolderFavorite({
          userId: actorUserId,
          folderId: folder.id,
          createdAt: now(),
        });
      } else {
        await activeRepo.deleteFolderFavorite({
          userId: actorUserId,
          folderId: folder.id,
        });
      }

      return {
        kind: "folder",
        id: folder.id,
        isFavorite,
        quickAccessPinnedAt: isFavorite ? undefined : null,
      };
    },

    async setFolderFavoriteQuickAccess({
      actorUserId,
      actorRole,
      folderId,
      quickAccessPinned,
    }: FolderQuickAccessInput): Promise<FavoriteMutationResult> {
      const activeRepo = await resolveRepo();
      const folder = assertActiveFolder(
        assertFolderAccess(
          {
            actorUserId,
            actorRole,
          },
          await activeRepo.findFolderById(folderId),
        ),
      );

      if (folder.isFilesRoot) {
        throw new FilesError("FOLDER_ROOT_IMMUTABLE");
      }

      const quickAccessPinnedAt = quickAccessPinned ? now() : null;
      const updated = await activeRepo.updateFolderFavoriteQuickAccess({
        userId: actorUserId,
        folderId: folder.id,
        quickAccessPinnedAt,
      });

      if (!updated) {
        throw new FilesError(
          "FOLDER_NOT_FOUND",
          "Favorite folder does not exist.",
        );
      }

      return {
        kind: "folder",
        id: folder.id,
        isFavorite: true,
        quickAccessPinnedAt,
      };
    },

    async recordFileAccess({
      actorUserId,
      actorRole,
      fileId,
      action,
    }: FileAccessInput): Promise<void> {
      const activeRepo = await resolveRepo();
      const file = assertFileAccess(
        {
          actorUserId,
          actorRole,
        },
        await activeRepo.findFileById(fileId),
      );

      await activeRepo.upsertRecentFile({
        userId: actorUserId,
        fileId: file.id,
        lastInteractedAt: now(),
        lastAction: action,
      });
    },

    async recordFolderAccess({
      actorUserId,
      actorRole,
      folderId,
      action,
    }: FolderAccessInput): Promise<void> {
      const activeRepo = await resolveRepo();
      const folder = assertFolderAccess(
        {
          actorUserId,
          actorRole,
        },
        await activeRepo.findFolderById(folderId),
      );

      if (folder.isFilesRoot) {
        return;
      }

      await activeRepo.upsertRecentFolder({
        userId: actorUserId,
        folderId: folder.id,
        lastInteractedAt: now(),
        lastAction: action,
      });
    },
  };
};

export const retrievalService = createRetrievalService();
