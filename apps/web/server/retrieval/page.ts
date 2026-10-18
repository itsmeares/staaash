import { getPrisma } from "@staaash/db/client";
import { prismaFilesRepository } from "@/server/files/repository";
import {
  buildFilePathLabel,
  buildFolderMap,
  buildFolderPathLabel,
} from "@/server/files/path-labels";
import {
  getListWindow,
  type ListQuery,
  type ListScope,
} from "@/server/list-window";
import { getStorageMutationStateMap } from "@/server/storage-read-guard";
import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { FavoriteRetrievalItem, RecentRetrievalItem } from "./types";

export async function getRetrievalPage(
  userId: string,
  scope: Exclude<ListScope, "folder" | "trash">,
  query: ListQuery = {},
  selected?: Awaited<ReturnType<typeof getListWindow>>,
) {
  const window = selected ?? (await getListWindow({ userId, scope, query }));
  return hydrateRetrievalPage(
    userId,
    window,
    scope === "added",
    scope === "favorites",
  );
}

export async function hydrateRetrievalPage(
  userId: string,
  window: Awaited<ReturnType<typeof getListWindow>>,
  createdDate = false,
  activePaths = false,
) {
  const fileIds = window.items
    .filter((item) => item.kind === "file")
    .map((item) => item.id);
  const folderIds = window.items
    .filter((item) => item.kind === "folder")
    .map((item) => item.id);
  const repo = prismaFilesRepository;
  const db = getPrisma();
  const [
    filesRoot,
    files,
    favoriteFiles,
    favoriteFolders,
    recentFiles,
    recentFolders,
    fileStates,
    folderStates,
  ] = await Promise.all([
    repo.findFilesRoot!(userId),
    repo.listFilesByIds(userId, fileIds, {
      includeDeleted: true,
      includeMissing: true,
    }),
    db.favoriteFile.findMany({ where: { userId, fileId: { in: fileIds } } }),
    db.favoriteFolder.findMany({
      where: { userId, folderId: { in: folderIds } },
    }),
    db.recentFile.findMany({ where: { userId, fileId: { in: fileIds } } }),
    db.recentFolder.findMany({
      where: { userId, folderId: { in: folderIds } },
    }),
    getStorageMutationStateMap("file", fileIds),
    getStorageMutationStateMap("folder", folderIds),
  ]);
  if (!filesRoot) throw new Error("The Files folder is missing.");
  const folders = await repo.listFolderAncestors(userId, [
    ...folderIds,
    ...files.flatMap((file) => (file.folderId ? [file.folderId] : [])),
  ]);
  const folderMap = buildFolderMap(
    activePaths ? folders.filter((folder) => !folder.deletedAt) : folders,
  );
  const fileMap = new Map(files.map((file) => [file.id, file]));
  const favorites = new Map([
    ...favoriteFiles.map(
      (f) =>
        [
          f.fileId,
          {
            createdAt: f.createdAt,
            quickAccessPinnedAt: f.quickAccessPinnedAt,
          },
        ] as const,
    ),
    ...favoriteFolders.map(
      (f) =>
        [
          f.folderId,
          {
            createdAt: f.createdAt,
            quickAccessPinnedAt: f.quickAccessPinnedAt,
          },
        ] as const,
    ),
  ]);
  const recents = new Map([
    ...recentFiles.map(
      (r) =>
        [
          r.fileId,
          { lastInteractedAt: r.lastInteractedAt, lastAction: r.lastAction },
        ] as const,
    ),
    ...recentFolders.map(
      (r) =>
        [
          r.folderId,
          { lastInteractedAt: r.lastInteractedAt, lastAction: r.lastAction },
        ] as const,
    ),
  ]);
  const items = window.items.flatMap(
    (ref): (FavoriteRetrievalItem & RecentRetrievalItem)[] => {
      const item =
        ref.kind === "folder" ? folderMap.get(ref.id) : fileMap.get(ref.id);
      if (!item) return [];
      const base = retrievalBase(
        item,
        favorites.get(item.id),
        recents.get(item.id),
        createdDate,
      );
      if ("folderId" in item)
        return [
          {
            ...base,
            kind: "file",
            folderId: item.folderId,
            mimeType: item.mimeType,
            sizeBytes: item.sizeBytes,
            href: item.viewerKind
              ? `/files/view/${item.id}`
              : `/api/files/view/${item.id}/download`,
            pathLabel: buildFilePathLabel({ file: item, folderMap, filesRoot }),
            storageMutation: fileStates.get(item.id),
          },
        ];
      return [
        {
          ...base,
          kind: "folder",
          parentId: item.parentId,
          color: item.color,
          href: item.isFilesRoot ? "/files" : `/files/f/${item.id}`,
          pathLabel: buildFolderPathLabel({
            folder: item,
            folderMap,
            filesRoot,
          }),
          storageMutation: folderStates.get(item.id),
        },
      ];
    },
  );
  return { items, total: window.total };
}

export async function getPinnedFavorites(userId: string) {
  const window = await getListWindow({
    userId,
    scope: "favorites",
    query: { pinnedOnly: true },
    all: true,
  });
  const items: Awaited<ReturnType<typeof hydrateRetrievalPage>>["items"] = [];
  for (let offset = 0; offset < window.items.length; offset += 1000) {
    items.push(
      ...(
        await hydrateRetrievalPage(userId, {
          items: window.items.slice(offset, offset + 1000),
          total: window.total,
        })
      ).items,
    );
  }
  return items;
}

export async function getRetrievalSelection(
  userId: string,
  scope: "favorites" | "recent" | "added",
  query: ListQuery,
) {
  const refs = await getListWindow({
    userId,
    scope,
    query: { ...query, offset: 0 },
    all: true,
  });
  const items: Awaited<ReturnType<typeof hydrateRetrievalPage>>["items"] = [];
  for (let offset = 0; offset < refs.items.length; offset += 1000) {
    items.push(
      ...(
        await hydrateRetrievalPage(
          userId,
          { items: refs.items.slice(offset, offset + 1000), total: refs.total },
          scope === "added",
          scope === "favorites",
        )
      ).items,
    );
  }
  return { items, total: items.length };
}

function retrievalBase(
  item: FileSummary | FolderSummary,
  favorite: { createdAt: Date; quickAccessPinnedAt: Date | null } | undefined,
  recent:
    | { lastInteractedAt: Date; lastAction: RecentRetrievalItem["lastAction"] }
    | undefined,
  createdDate: boolean,
) {
  const favoriteDates = favorite ?? {
    createdAt: item.createdAt,
    quickAccessPinnedAt: null,
  };
  const recentDates = recent ?? {
    lastInteractedAt: item.createdAt,
    lastAction: null,
  };
  return {
    id: item.id,
    name: item.name,
    deletedAt: item.deletedAt,
    updatedAt: createdDate ? item.createdAt : item.updatedAt,
    isFavorite: Boolean(favorite),
    favoritedAt: favoriteDates.createdAt,
    quickAccessPinnedAt: favoriteDates.quickAccessPinnedAt,
    ...recentDates,
  };
}
