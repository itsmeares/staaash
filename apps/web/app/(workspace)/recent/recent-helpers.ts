import type { RetrievalItem } from "@/server/retrieval/types";

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

export type RecentClientItem = {
  deletedAt: string | null;
  folderId?: string | null;
  href: string;
  id: string;
  isFavorite: boolean;
  kind: RetrievalItem["kind"];
  locationLabel: string;
  mimeType?: string;
  name: string;
  parentId?: string | null;
  sizeBytes?: number;
  uploadedAt: string;
};

export type RecentFilterType = WorkspaceItemFilterType;

export type RecentSortKey = "name" | "path" | "size" | "uploadedAt";
export type RecentSortDirection = WorkspaceSortDirection;

const RECENT_GROUP_ORDER = [
  "Today",
  "Yesterday",
  "This week",
  "This month",
  "Older",
] as const;

export type RecentGroupLabel = (typeof RECENT_GROUP_ORDER)[number];

export type RecentGroup<T> = {
  label: RecentGroupLabel;
  items: T[];
};

export function getRecentLocationLabel(item: RetrievalItem): string {
  return getWorkspaceLocationLabel(item);
}

export function toRecentClientItem(item: RetrievalItem): RecentClientItem {
  return {
    folderId: item.kind === "file" ? item.folderId : undefined,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    href: item.href,
    id: item.id,
    isFavorite: item.isFavorite,
    kind: item.kind,
    locationLabel: getRecentLocationLabel(item),
    mimeType: item.kind === "file" ? item.mimeType : undefined,
    name: item.name,
    parentId: item.kind === "folder" ? item.parentId : undefined,
    sizeBytes: item.kind === "file" ? item.sizeBytes : undefined,
    uploadedAt: item.updatedAt.toISOString(),
  };
}

export function getRecentType(
  item: Pick<RecentClientItem, "kind" | "mimeType">,
): RecentFilterType {
  return getWorkspaceItemType(item);
}

export function filterRecentItems(
  items: RecentClientItem[],
  filterType: RecentFilterType,
): RecentClientItem[] {
  return filterWorkspaceItems(items, filterType);
}

export function formatRecentFileSize(bytes?: number): string {
  return formatWorkspaceFileSize(bytes);
}

export function formatRecentRelativeTime(
  value: Date | string,
  now = new Date(),
): string {
  return formatWorkspaceRelativeTime(value, now);
}

export function getRecentDateGroup(
  value: Date | string,
  now = new Date(),
): RecentGroupLabel {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(startOfWeek.getDate() - daysToMonday);

  if (date >= startOfWeek) return "This week";
  if (diffDays < 30) return "This month";
  return "Older";
}

export function sortRecentItems(
  items: RecentClientItem[],
  sortKey: RecentSortKey,
  sortDirection: RecentSortDirection,
): RecentClientItem[] {
  return sortWorkspaceItems(items, sortDirection, (left, right) => {
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
      new Date(left.uploadedAt).getTime() - new Date(right.uploadedAt).getTime()
    );
  });
}

export function groupRecentItems<T extends { uploadedAt: string }>(
  items: T[],
  now = new Date(),
): RecentGroup<T>[] {
  const map = new Map<RecentGroupLabel, T[]>();

  for (const item of items) {
    const label = getRecentDateGroup(item.uploadedAt, now);
    map.set(label, [...(map.get(label) ?? []), item]);
  }

  return RECENT_GROUP_ORDER.flatMap((label) => {
    const group = map.get(label);
    return group ? [{ label, items: group }] : [];
  });
}
