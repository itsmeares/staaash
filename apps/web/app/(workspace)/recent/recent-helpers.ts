import {
  DATE_GROUP_ORDER,
  getDateGroup,
  type DateGroupLabel,
} from "@/lib/time";
import type { RetrievalItem } from "@/server/retrieval/types";

import {
  compareListItems,
  filterWorkspaceItems,
  sortWorkspaceItems,
  type WorkspaceItemFilterType,
  type WorkspaceSortDirection,
  toWorkspaceListFields,
} from "../workspace-item-helpers";

export type RecentClientItem = {
  deletedAt: string | null;
  folderId?: string | null;
  href: string;
  id: string;
  isFavorite: boolean;
  kind: RetrievalItem["kind"];
  locationLabel: string;
  color?: string | null;
  mimeType?: string;
  name: string;
  parentId?: string | null;
  sizeBytes?: number;
  storageMutationStatus?: string;
  uploadedAt: string;
};

export type RecentFilterType = WorkspaceItemFilterType;

export type RecentSortKey = "name" | "path" | "size" | "uploadedAt";
export type RecentSortDirection = WorkspaceSortDirection;

export type RecentGroupLabel = DateGroupLabel;

export type RecentGroup<T> = {
  label: RecentGroupLabel;
  items: T[];
};

export function toRecentClientItem(item: RetrievalItem): RecentClientItem {
  return {
    ...toWorkspaceListFields(item),
    deletedAt: item.deletedAt?.toISOString() ?? null,
    isFavorite: item.isFavorite,
    uploadedAt: item.updatedAt.toISOString(),
  };
}

export function filterRecentItems(
  items: RecentClientItem[],
  filterType: RecentFilterType,
): RecentClientItem[] {
  return filterWorkspaceItems(items, filterType);
}

export function sortRecentItems(
  items: RecentClientItem[],
  sortKey: RecentSortKey,
  sortDirection: RecentSortDirection,
): RecentClientItem[] {
  return sortWorkspaceItems(
    items,
    sortDirection,
    compareListItems(sortKey, (item: RecentClientItem) => item.uploadedAt),
  );
}

export function groupRecentItems<T extends { uploadedAt: string }>(
  items: T[],
  now: Date,
  timeZone: string,
): RecentGroup<T>[] {
  const map = new Map<RecentGroupLabel, T[]>();

  for (const item of items) {
    const label = getDateGroup(item.uploadedAt, now, timeZone);
    map.set(label, [...(map.get(label) ?? []), item]);
  }

  return DATE_GROUP_ORDER.flatMap((label) => {
    const group = map.get(label);
    return group ? [{ label, items: group }] : [];
  });
}
