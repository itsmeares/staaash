import { canAccessPrivateNamespace } from "@/server/access";
import { FilesError } from "@/server/files/errors";
import type {
  FilesActor,
  FileSummary,
  FolderSummary,
} from "@/server/files/types";
import {
  compareSearchResults,
  getSearchMatchKind,
  normalizeSearchText,
} from "@/server/search";

import type {
  FavoriteMutationResult,
  RetrievalItem,
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

type FolderFavoriteInput = FilesActor & {
  folderId: string;
  isFavorite: boolean;
};

type FileAccessInput = FilesActor & {
  fileId: string;
};

type FolderAccessInput = FilesActor & {
  folderId: string;
};

const getFolderHref = (folder: Pick<FolderSummary, "id" | "isFilesRoot">) =>
  folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`;

const getFileHref = (file: Pick<FileSummary, "id" | "viewerKind">) =>
  file.viewerKind
    ? `/files/view/${file.id}`
    : `/api/files/view/${file.id}/download`;

const buildFolderMap = (folders: FolderSummary[]) =>
  new Map(folders.map((folder) => [folder.id, folder]));

const buildFolderPathLabel = ({
  folder,
  folderMap,
  filesRoot,
}: {
  folder: FolderSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
}) => {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: FolderSummary | undefined = folder;
  let reachedRoot = false;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);

    if (current.id === filesRoot.id) {
      reachedRoot = true;
      break;
    }

    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  if (!reachedRoot) {
    names.unshift(filesRoot.name);
  }

  return names.join(" / ");
};

const buildFilePathLabel = ({
  file,
  folderMap,
  filesRoot,
}: {
  file: FileSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
}) => {
  const parent =
    file.folderId && folderMap.has(file.folderId)
      ? folderMap.get(file.folderId)
      : filesRoot;

  const folderPath = parent
    ? buildFolderPathLabel({
        folder: parent,
        folderMap,
        filesRoot,
      })
    : filesRoot.name;

  return `${folderPath} / ${file.name}`;
};

const computeMatchingFolderAndDescendantIds = (
  folders: FolderSummary[],
  normalizedQuery: string,
): string[] => {
  const childrenMap = new Map<string | null, string[]>();
  for (const folder of folders) {
    const list = childrenMap.get(folder.parentId) ?? [];
    list.push(folder.id);
    childrenMap.set(folder.parentId, list);
  }

  const seeds = folders
    .filter(
      (f) =>
        !f.isFilesRoot &&
        getSearchMatchKind(normalizedQuery, f.name, "") !== null,
    )
    .map((f) => f.id);

  const result = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    result.add(id);
    for (const child of childrenMap.get(id) ?? []) {
      if (!result.has(child)) queue.push(child);
    }
  }
  return [...result];
};

const compareRetrievalItems = (left: RetrievalItem, right: RetrievalItem) => {
  const pathDelta = normalizeSearchText(left.pathLabel).localeCompare(
    normalizeSearchText(right.pathLabel),
  );

  if (pathDelta !== 0) {
    return pathDelta;
  }

  const nameDelta = normalizeSearchText(left.name).localeCompare(
    normalizeSearchText(right.name),
  );

  if (nameDelta !== 0) {
    return nameDelta;
  }

  return left.id.localeCompare(right.id);
};

const toFolderItem = ({
  folder,
  folderMap,
  filesRoot,
  favoriteFolderIds,
}: {
  folder: FolderSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
  favoriteFolderIds: Set<string>;
}): RetrievalItem => ({
  kind: "folder",
  id: folder.id,
  name: folder.name,
  pathLabel: buildFolderPathLabel({
    folder,
    folderMap,
    filesRoot,
  }),
  href: getFolderHref(folder),
  updatedAt: folder.updatedAt,
  isFavorite: favoriteFolderIds.has(folder.id),
  parentId: folder.parentId,
});

const toFileItem = ({
  file,
  folderMap,
  filesRoot,
  favoriteFileIds,
}: {
  file: FileSummary;
  folderMap: Map<string, FolderSummary>;
  filesRoot: FolderSummary;
  favoriteFileIds: Set<string>;
}): RetrievalItem => ({
  kind: "file",
  id: file.id,
  name: file.name,
  pathLabel: buildFilePathLabel({
    file,
    folderMap,
    filesRoot,
  }),
  href: getFileHref(file),
  updatedAt: file.updatedAt,
  isFavorite: favoriteFileIds.has(file.id),
  folderId: file.folderId,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
});

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
    throw new FilesError("ACCESS_DENIED");
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
    throw new FilesError("ACCESS_DENIED");
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

export const createRetrievalService = ({
  repo,
  now = () => new Date(),
}: CreateRetrievalServiceOptions = {}) => {
  const resolveRepo = async (): Promise<RetrievalRepository> =>
    repo ?? (await import("./repository")).prismaRetrievalRepository;

  const getFavoriteState = async (userId: string) => {
    const activeRepo = await resolveRepo();
    const [favoriteFiles, favoriteFolders] = await Promise.all([
      activeRepo.listFavoriteFiles(userId),
      activeRepo.listFavoriteFolders(userId),
    ]);

    return {
      favoriteFiles,
      favoriteFolders,
      favoriteFileIds: new Set(
        favoriteFiles.map((favorite) => favorite.fileId),
      ),
      favoriteFolderIds: new Set(
        favoriteFolders.map((favorite) => favorite.folderId),
      ),
    };
  };

  return {
    async search({
      actorUserId,
      query,
    }: FilesActor & { query: string }): Promise<RetrievalItem[]> {
      const trimmedQuery = query.trim();

      if (trimmedQuery.length === 0) {
        return [];
      }

      const activeRepo = await resolveRepo();
      const [filesRoot, folders, favoriteState] = await Promise.all([
        activeRepo.ensureFilesRoot(actorUserId),
        activeRepo.listFoldersByOwner(actorUserId),
        getFavoriteState(actorUserId),
      ]);

      const normalizedQuery = normalizeSearchText(trimmedQuery);
      const matchingFolderIds = computeMatchingFolderAndDescendantIds(
        folders,
        normalizedQuery,
      );
      const files = await activeRepo.searchFilesByOwner(
        actorUserId,
        trimmedQuery,
        matchingFolderIds,
      );
      const folderMap = buildFolderMap(folders);
      const baseItems = [
        ...folders
          .filter((folder) => !folder.isFilesRoot)
          .map((folder) =>
            toFolderItem({
              folder,
              folderMap,
              filesRoot,
              favoriteFolderIds: favoriteState.favoriteFolderIds,
            }),
          ),
        ...files.map((file) =>
          toFileItem({
            file,
            folderMap,
            filesRoot,
            favoriteFileIds: favoriteState.favoriteFileIds,
          }),
        ),
      ];

      return baseItems
        .flatMap((item) => {
          const matchKind = getSearchMatchKind(
            trimmedQuery,
            item.name,
            item.pathLabel,
          );

          return matchKind ? [{ ...item, matchKind }] : [];
        })
        .sort((left, right) =>
          compareSearchResults(
            {
              id: left.id,
              name: left.name,
              path: left.pathLabel,
              updatedAt: left.updatedAt,
              matchKind: left.matchKind!,
            },
            {
              id: right.id,
              name: right.name,
              path: right.pathLabel,
              updatedAt: right.updatedAt,
              matchKind: right.matchKind!,
            },
          ),
        );
    },

    async listFavorites({ actorUserId }: FilesActor): Promise<RetrievalItem[]> {
      const activeRepo = await resolveRepo();
      const [
        filesRoot,
        folders,
        files,
        favoriteFiles,
        favoriteFolders,
        favoriteState,
      ] = await Promise.all([
        activeRepo.ensureFilesRoot(actorUserId),
        activeRepo.listFoldersByOwner(actorUserId),
        activeRepo.listFilesByOwner(actorUserId),
        activeRepo.listFavoriteFiles(actorUserId),
        activeRepo.listFavoriteFolders(actorUserId),
        getFavoriteState(actorUserId),
      ]);
      const folderMap = buildFolderMap(folders);
      const folderById = new Map(folders.map((folder) => [folder.id, folder]));
      const fileById = new Map(files.map((file) => [file.id, file]));
      const items = [
        ...favoriteFolders.map((favorite) => ({
          kind: "folder" as const,
          createdAt: favorite.createdAt,
          item: favorite.folderId ? folderById.get(favorite.folderId) : null,
        })),
        ...favoriteFiles.map((favorite) => ({
          kind: "file" as const,
          createdAt: favorite.createdAt,
          item: favorite.fileId ? fileById.get(favorite.fileId) : null,
        })),
      ]
        .filter(
          (
            entry,
          ): entry is
            | {
                kind: "folder";
                createdAt: Date;
                item: FolderSummary;
              }
            | {
                kind: "file";
                createdAt: Date;
                item: FileSummary;
              } =>
            entry.item != null &&
            !(
              entry.kind === "folder" &&
              (entry.item as FolderSummary).isFilesRoot
            ),
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            compareRetrievalItems(
              left.kind === "folder"
                ? toFolderItem({
                    folder: left.item as FolderSummary,
                    folderMap,
                    filesRoot,
                    favoriteFolderIds: favoriteState.favoriteFolderIds,
                  })
                : toFileItem({
                    file: left.item as FileSummary,
                    folderMap,
                    filesRoot,
                    favoriteFileIds: favoriteState.favoriteFileIds,
                  }),
              right.kind === "folder"
                ? toFolderItem({
                    folder: right.item as FolderSummary,
                    folderMap,
                    filesRoot,
                    favoriteFolderIds: favoriteState.favoriteFolderIds,
                  })
                : toFileItem({
                    file: right.item as FileSummary,
                    folderMap,
                    filesRoot,
                    favoriteFileIds: favoriteState.favoriteFileIds,
                  }),
            ),
        );

      return items.map((entry) =>
        entry.kind === "folder"
          ? toFolderItem({
              folder: entry.item as FolderSummary,
              folderMap,
              filesRoot,
              favoriteFolderIds: favoriteState.favoriteFolderIds,
            })
          : toFileItem({
              file: entry.item as FileSummary,
              folderMap,
              filesRoot,
              favoriteFileIds: favoriteState.favoriteFileIds,
            }),
      );
    },

    async listRecent({ actorUserId }: FilesActor): Promise<RetrievalItem[]> {
      const activeRepo = await resolveRepo();
      const [
        filesRoot,
        folders,
        files,
        recentFiles,
        recentFolders,
        favoriteState,
      ] = await Promise.all([
        activeRepo.ensureFilesRoot(actorUserId),
        activeRepo.listFoldersByOwner(actorUserId),
        activeRepo.listFilesByOwner(actorUserId),
        activeRepo.listRecentFiles(actorUserId),
        activeRepo.listRecentFolders(actorUserId),
        getFavoriteState(actorUserId),
      ]);
      const folderMap = buildFolderMap(folders);
      const folderById = new Map(folders.map((folder) => [folder.id, folder]));
      const fileById = new Map(files.map((file) => [file.id, file]));
      const items = [
        ...recentFolders.map((recent) => ({
          kind: "folder" as const,
          lastInteractedAt: recent.lastInteractedAt,
          item: recent.folderId ? folderById.get(recent.folderId) : null,
        })),
        ...recentFiles.map((recent) => ({
          kind: "file" as const,
          lastInteractedAt: recent.lastInteractedAt,
          item: recent.fileId ? fileById.get(recent.fileId) : null,
        })),
      ]
        .filter(
          (
            entry,
          ): entry is
            | {
                kind: "folder";
                lastInteractedAt: Date;
                item: FolderSummary;
              }
            | {
                kind: "file";
                lastInteractedAt: Date;
                item: FileSummary;
              } =>
            entry.item != null &&
            !(
              entry.kind === "folder" &&
              (entry.item as FolderSummary).isFilesRoot
            ),
        )
        .sort(
          (left, right) =>
            right.lastInteractedAt.getTime() -
              left.lastInteractedAt.getTime() ||
            compareRetrievalItems(
              left.kind === "folder"
                ? toFolderItem({
                    folder: left.item as FolderSummary,
                    folderMap,
                    filesRoot,
                    favoriteFolderIds: favoriteState.favoriteFolderIds,
                  })
                : toFileItem({
                    file: left.item as FileSummary,
                    folderMap,
                    filesRoot,
                    favoriteFileIds: favoriteState.favoriteFileIds,
                  }),
              right.kind === "folder"
                ? toFolderItem({
                    folder: right.item as FolderSummary,
                    folderMap,
                    filesRoot,
                    favoriteFolderIds: favoriteState.favoriteFolderIds,
                  })
                : toFileItem({
                    file: right.item as FileSummary,
                    folderMap,
                    filesRoot,
                    favoriteFileIds: favoriteState.favoriteFileIds,
                  }),
            ),
        );

      return items.map((entry) =>
        entry.kind === "folder"
          ? toFolderItem({
              folder: entry.item as FolderSummary,
              folderMap,
              filesRoot,
              favoriteFolderIds: favoriteState.favoriteFolderIds,
            })
          : toFileItem({
              file: entry.item as FileSummary,
              folderMap,
              filesRoot,
              favoriteFileIds: favoriteState.favoriteFileIds,
            }),
      );
    },

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
      };
    },

    async recordFileAccess({
      actorUserId,
      actorRole,
      fileId,
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
      });
    },

    async recordFolderAccess({
      actorUserId,
      actorRole,
      folderId,
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
      });
    },
  };
};

export const retrievalService = createRetrievalService();
