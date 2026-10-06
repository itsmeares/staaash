import {
  DATE_GROUP_ORDER,
  getDateGroup,
  type DateGroupLabel,
} from "@/lib/time";
import type { RetrievalItem } from "@/server/retrieval/types";

import {
  compareWorkspaceStrings,
  filterWorkspaceItems,
  formatWorkspaceFileSize,
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
    storageMutationStatus: item.storageMutation?.status,
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
