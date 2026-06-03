import type { FavoriteRetrievalItem } from "@/server/retrieval/types";

import {
  compareWorkspaceStrings,
  filterWorkspaceItems,
  formatWorkspaceFileSize,
  formatWorkspaceRelativeTime,
  getWorkspaceItemType,
  getWorkspaceLocationLabel,
  sortWorkspaceItems,
  type WorkspaceItemFilterType,
  type WorkspaceSortDirection,
} from "../workspace-item-helpers";

export type FavoriteClientItem = {
  favoritedAt: string;
  folderId?: string | null;
  href: string;
  id: string;
  kind: FavoriteRetrievalItem["kind"];
  locationLabel: string;
  mimeType?: string;
  name: string;
  parentId?: string | null;
  quickAccessPinnedAt: string | null;
  sizeBytes?: number;
};

export type FavoriteFilterType = WorkspaceItemFilterType;

export type FavoriteSortKey = "favoritedAt" | "name" | "path" | "size";
export type FavoriteSortDirection = WorkspaceSortDirection;

export function getFavoriteLocationLabel(item: FavoriteRetrievalItem): string {
  return getWorkspaceLocationLabel(item);
}

export function toFavoriteClientItem(
  item: FavoriteRetrievalItem,
): FavoriteClientItem {
  return {
    favoritedAt: item.favoritedAt.toISOString(),
    folderId: item.kind === "file" ? item.folderId : undefined,
    href: item.href,
    id: item.id,
    kind: item.kind,
    locationLabel: getFavoriteLocationLabel(item),
    mimeType: item.kind === "file" ? item.mimeType : undefined,
    name: item.name,
    parentId: item.kind === "folder" ? item.parentId : undefined,
    quickAccessPinnedAt: item.quickAccessPinnedAt?.toISOString() ?? null,
    sizeBytes: item.kind === "file" ? item.sizeBytes : undefined,
  };
}

export function getFavoriteType(
  item: Pick<FavoriteClientItem, "kind" | "mimeType">,
): FavoriteFilterType {
  return getWorkspaceItemType(item);
}

export function filterFavoriteItems(
  items: FavoriteClientItem[],
  filterType: FavoriteFilterType,
): FavoriteClientItem[] {
  return filterWorkspaceItems(items, filterType);
}

export function formatFavoriteFileSize(bytes?: number): string {
  return formatWorkspaceFileSize(bytes);
}

export function formatFavoriteRelativeTime(
  value: Date | string,
  now = new Date(),
): string {
  return formatWorkspaceRelativeTime(value, now);
}

export function sortFavoriteItems(
  items: FavoriteClientItem[],
  sortKey: FavoriteSortKey,
  sortDirection: FavoriteSortDirection,
): FavoriteClientItem[] {
  return sortWorkspaceItems(
    items,
    sortDirection,
    (left, right) => {
      if (sortKey === "name") {
        return compareWorkspaceStrings(left.name, right.name);
      }
      if (sortKey === "path") {
        return compareWorkspaceStrings(left.locationLabel, right.locationLabel);
      }
      if (sortKey === "size") {
        return (left.sizeBytes ?? -1) - (right.sizeBytes ?? -1);
      }
      return (
        new Date(left.favoritedAt).getTime() -
        new Date(right.favoritedAt).getTime()
      );
    },
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
