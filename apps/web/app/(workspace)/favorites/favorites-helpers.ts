import type { FavoriteRetrievalItem } from "@/server/retrieval/types";

import {
  compareListItems,
  compareWorkspaceStrings,
  filterWorkspaceItems,
  sortWorkspaceItems,
  type WorkspaceItemFilterType,
  type WorkspaceSortDirection,
  toWorkspaceListFields,
} from "../workspace-item-helpers";

export type FavoriteClientItem = {
  favoritedAt: string;
  folderId?: string | null;
  href: string;
  id: string;
  kind: FavoriteRetrievalItem["kind"];
  locationLabel: string;
  color?: string | null;
  mimeType?: string;
  name: string;
  parentId?: string | null;
  quickAccessPinnedAt: string | null;
  sizeBytes?: number;
  storageMutationStatus?: string;
};

export type FavoriteFilterType = WorkspaceItemFilterType;

export type FavoriteSortKey = "favoritedAt" | "name" | "path" | "size";
export type FavoriteSortDirection = WorkspaceSortDirection;

export function toFavoriteClientItem(
  item: FavoriteRetrievalItem,
): FavoriteClientItem {
  return {
    ...toWorkspaceListFields(item),
    favoritedAt: item.favoritedAt.toISOString(),
    quickAccessPinnedAt: item.quickAccessPinnedAt?.toISOString() ?? null,
  };
}

export function filterFavoriteItems(
  items: FavoriteClientItem[],
  filterType: FavoriteFilterType,
): FavoriteClientItem[] {
  return filterWorkspaceItems(items, filterType);
}

export function sortFavoriteItems(
  items: FavoriteClientItem[],
  sortKey: FavoriteSortKey,
  sortDirection: FavoriteSortDirection,
): FavoriteClientItem[] {
  return sortWorkspaceItems(
    items,
    sortDirection,
    compareListItems(sortKey, (item: FavoriteClientItem) => item.favoritedAt),
    { includeKindTieBreak: true },
  );
}

export function getQuickAccessFavorites(
  items: FavoriteClientItem[],
): FavoriteClientItem[] {
  return [...items]
    .filter((item) => item.quickAccessPinnedAt != null)
    .sort((left, right) => {
      const delta =
        new Date(right.quickAccessPinnedAt!).getTime() -
        new Date(left.quickAccessPinnedAt!).getTime();

      if (delta !== 0) return delta;
      return (
        compareWorkspaceStrings(left.name, right.name) ||
        left.id.localeCompare(right.id)
      );
    });
}
