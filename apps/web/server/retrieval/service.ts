// Retrieval variants intentionally share stable ordering and access guards.
// fallow-ignore-file code-duplication
import { canAccessPrivateNamespace } from "@/server/access";
import { FilesError } from "@/server/files/errors";
import type {
  FilesActor,
  FileSummary,
  FolderSummary,
} from "@/server/files/types";
import {
  buildFilePathLabel,
  buildFolderMap,
  buildFolderPathLabel,
} from "@/server/files/path-labels";
import {
  compareSearchResults,
  getSearchMatchKind,
  normalizeSearchText,
  prepareSearchCandidate,
} from "@/server/search";
import { getStorageMutationStateMap } from "@/server/storage-read-guard";

import type {
  FavoriteMutationResult,
  FavoriteRetrievalItem,
  RecentAction,
  RecentRetrievalItem,
  RetrievalItem,
  RetrievalRepository,
  RetrievalListOptions,
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

const getFolderHref = (folder: Pick<FolderSummary, "id" | "isFilesRoot">) =>
  folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`;

const getFileHref = (file: Pick<FileSummary, "id" | "viewerKind">) =>
  file.viewerKind
    ? `/files/view/${file.id}`
    : `/api/files/view/${file.id}/download`;

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
        getSearchMatchKind(
          normalizedQuery,
          prepareSearchCandidate(f.name, ""),
        ) !== null,
    )
    .map((f) => f.id);

  const result = new Set(seeds);
  const queue = [...result];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const child of childrenMap.get(id) ?? []) {
      if (!result.has(child)) {
        result.add(child);
        queue.push(child);
      }
    }
  }
  return [...result];
};

const prepareRetrievalItem = <T extends RetrievalItem>(item: T) => ({
  item,
  sortPath: normalizeSearchText(item.pathLabel),
  sortName: normalizeSearchText(item.name),
});

const compareRetrievalItems = (
  left: ReturnType<typeof prepareRetrievalItem>,
  right: ReturnType<typeof prepareRetrievalItem>,
) =>
  left.sortPath.localeCompare(right.sortPath) ||
  left.sortName.localeCompare(right.sortName) ||
  left.item.id.localeCompare(right.item.id);

const decorateRetrievalStorageState = async <T extends RetrievalItem>(
  items: T[],
): Promise<T[]> => {
  const [folderStates, fileStates] = await Promise.all([
    getStorageMutationStateMap(
      "folder",
      items.filter((item) => item.kind === "folder").map((item) => item.id),
    ),
    getStorageMutationStateMap(
      "file",
      items.filter((item) => item.kind === "file").map((item) => item.id),
    ),
  ]);
  return items.map((item) => ({
    ...item,
    storageMutation:
      (item.kind === "folder" ? folderStates : fileStates).get(item.id) ?? null,
  }));
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
  deletedAt: folder.deletedAt,
  isFavorite: favoriteFolderIds.has(folder.id),
  parentId: folder.parentId,
  color: folder.color ?? null,
  storageMutation: null,
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
  deletedAt: file.deletedAt,
  isFavorite: favoriteFileIds.has(file.id),
  folderId: file.folderId,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  storageMutation: null,
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

// Test-only dependency-injection seam.
// fallow-ignore-next-line unused-export
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

  const resolveReferencedItems = async (
    ownerUserId: string,
    files: FileSummary[],
    folderIds: string[],
    options: RetrievalListOptions = {},
  ) => {
    const repository = await resolveRepo();
    const folders = await repository.listFolderAncestors(ownerUserId, [
      ...folderIds,
      ...files.flatMap((file) => (file.folderId ? [file.folderId] : [])),
    ]);
    return {
      fileMap: new Map(files.map((file) => [file.id, file])),
      folderMap: buildFolderMap(
        folders.filter((folder) => options.includeDeleted || !folder.deletedAt),
      ),
    };
  };

  return {
    async search({
      actorUserId,
      query,
    }: FilesActor & { query: string }): Promise<RetrievalItem[]> {
      const trimmedQuery = query.trim();
      const normalizedQuery = normalizeSearchText(trimmedQuery);

      if (normalizedQuery.length === 0) {
        return [];
      }

      const activeRepo = await resolveRepo();
      const [filesRoot, folders, favoriteState] = await Promise.all([
        activeRepo.ensureFilesRoot(actorUserId),
        activeRepo.listFoldersByOwner(actorUserId),
        getFavoriteState(actorUserId),
      ]);

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

      return decorateRetrievalStorageState(
        baseItems
          .flatMap((item) => {
            const candidate = prepareSearchCandidate(item.name, item.pathLabel);
            const matchKind = getSearchMatchKind(normalizedQuery, candidate);
            return matchKind
              ? [
                  {
                    ...item,
                    matchKind,
                    normalizedName: candidate.normalizedName,
                    normalizedPath: candidate.normalizedPath,
                  },
                ]
              : [];
          })
          .sort(compareSearchResults)
          .map(
            ({ normalizedName: _name, normalizedPath: _path, ...item }) => item,
          ),
      );
    },

    async listFavorites({
      actorUserId,
    }: FilesActor): Promise<FavoriteRetrievalItem[]> {
      const activeRepo = await resolveRepo();
      const [filesRoot, files, favoriteState] = await Promise.all([
        activeRepo.ensureFilesRoot(actorUserId),
        activeRepo.listFilesByOwner(actorUserId, { favoritesOnly: true }),
        getFavoriteState(actorUserId),
      ]);
      const { favoriteFiles, favoriteFolders } = favoriteState;
      const { folderMap, fileMap } = await resolveReferencedItems(
        actorUserId,
        files,
        favoriteFolders.map((f) => f.folderId),
      );
      const items = [
        ...favoriteFolders.flatMap((favorite) => {
          const folder = folderMap.get(favorite.folderId);
          return folder && !folder.isFilesRoot
            ? [
                {
                  ...toFolderItem({
                    folder,
                    folderMap,
                    filesRoot,
                    favoriteFolderIds: favoriteState.favoriteFolderIds,
                  }),
                  favoritedAt: favorite.createdAt,
                  quickAccessPinnedAt: favorite.quickAccessPinnedAt,
                },
              ]
            : [];
        }),
        ...favoriteFiles.flatMap((favorite) => {
          const file = fileMap.get(favorite.fileId);
          return file
            ? [
                {
                  ...toFileItem({
                    file,
                    folderMap,
                    filesRoot,
                    favoriteFileIds: favoriteState.favoriteFileIds,
                  }),
                  favoritedAt: favorite.createdAt,
                  quickAccessPinnedAt: favorite.quickAccessPinnedAt,
                },
              ]
            : [];
        }),
      ]
        .map(prepareRetrievalItem)
        .sort(
          (left, right) =>
            right.item.favoritedAt.getTime() -
              left.item.favoritedAt.getTime() ||
            compareRetrievalItems(left, right),
        )
        .map(({ item }) => item);
      return decorateRetrievalStorageState(items);
    },

    async listRecentlyAdded({
      actorUserId,
    }: FilesActor): Promise<RetrievalItem[]> {
      const activeRepo = await resolveRepo();
      const [filesRoot, folders, files, favoriteState] = await Promise.all([
        activeRepo.ensureFilesRoot(actorUserId),
        activeRepo.listFoldersByOwner(actorUserId, { includeDeleted: true }),
        activeRepo.listFilesByOwner(actorUserId, { includeDeleted: true }),
        getFavoriteState(actorUserId),
      ]);
      const folderMap = buildFolderMap(folders);
      const items = [
        ...folders
          .filter((folder) => !folder.isFilesRoot)
          .map((folder) => ({
            createdAt: folder.createdAt,
            item: {
              ...toFolderItem({
                folder,
                folderMap,
                filesRoot,
                favoriteFolderIds: favoriteState.favoriteFolderIds,
              }),
              updatedAt: folder.createdAt,
            },
          })),
        ...files.map((file) => ({
          createdAt: file.createdAt,
          item: {
            ...toFileItem({
              file,
              folderMap,
              filesRoot,
              favoriteFileIds: favoriteState.favoriteFileIds,
            }),
            updatedAt: file.createdAt,
          },
        })),
      ];

      return decorateRetrievalStorageState(
        items
          .map(({ item, createdAt }) => ({
            ...prepareRetrievalItem(item),
            createdAt,
          }))
          .sort(
            (left, right) =>
              right.createdAt.getTime() - left.createdAt.getTime() ||
              compareRetrievalItems(left, right),
          )
          .map((entry) => entry.item),
      );
    },

    /** Activity, newest first. Trashed items stay, so Recent can say so. */
    async listRecent({
      actorUserId,
    }: FilesActor): Promise<RecentRetrievalItem[]> {
      const activeRepo = await resolveRepo();
      const [filesRoot, recentFiles, recentFolders, favoriteState] =
        await Promise.all([
          activeRepo.ensureFilesRoot(actorUserId),
          activeRepo.listRecentFiles(actorUserId),
          activeRepo.listRecentFolders(actorUserId),
          getFavoriteState(actorUserId),
        ]);
      const files = await activeRepo.listFilesByIds(
        actorUserId,
        recentFiles.map((r) => r.fileId),
        { includeDeleted: true },
      );
      const { folderMap, fileMap } = await resolveReferencedItems(
        actorUserId,
        files,
        recentFolders.map((r) => r.folderId),
        { includeDeleted: true },
      );
      const items = [
        ...recentFolders.flatMap((recent) => {
          const folder = folderMap.get(recent.folderId);
          return folder && !folder.isFilesRoot
            ? [
                prepareRetrievalItem({
                  ...toFolderItem({
                    folder,
                    folderMap,
                    filesRoot,
                    favoriteFolderIds: favoriteState.favoriteFolderIds,
                  }),
                  lastInteractedAt: recent.lastInteractedAt,
                  lastAction: recent.lastAction,
                }),
              ]
            : [];
        }),
        ...recentFiles.flatMap((recent) => {
          const file = fileMap.get(recent.fileId);
          return file
            ? [
                prepareRetrievalItem({
                  ...toFileItem({
                    file,
                    folderMap,
                    filesRoot,
                    favoriteFileIds: favoriteState.favoriteFileIds,
                  }),
                  lastInteractedAt: recent.lastInteractedAt,
                  lastAction: recent.lastAction,
                }),
              ]
            : [];
        }),
      ]
        .sort(
          (left, right) =>
            right.item.lastInteractedAt.getTime() -
              left.item.lastInteractedAt.getTime() ||
            compareRetrievalItems(left, right),
        )
        .map(({ item }) => item);
      return decorateRetrievalStorageState(items);
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
