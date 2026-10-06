import {
  DATE_GROUP_ORDER,
  getDateGroup,
  type DateGroupLabel,
} from "@/lib/time";
import type {
  TrashFileSummary,
  TrashFolderSummary,
  TrashListing,
} from "@/server/files/types";

export type TrashClientItem = {
  deletedAt: string;
  id: string;
  kind: "file" | "folder";
  mimeType?: string;
  name: string;
  originalPathLabel: string;
  restoreTargetLabel: string;
  sizeBytes?: number;
  storageMutationStatus?: string;
};

export type TrashFilterType = "all" | "file" | "folder";
export type TrashSortOrder = "newest" | "oldest";

export const TRASH_FILTERS: { id: TrashFilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "file", label: "Files" },
];

export const TRASH_SORT_OPTIONS: { id: TrashSortOrder; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
];

export type TrashGroupLabel = DateGroupLabel;

export type TrashGroup<T> = {
  items: T[];
  label: TrashGroupLabel;
};

function getDeletedAt(value: Date | null, fallback: Date): string {
  return (value ?? fallback).toISOString();
}

export function toTrashClientItem(
  item: TrashFolderSummary | TrashFileSummary,
): TrashClientItem {
  if ("folder" in item) {
    return {
      deletedAt: getDeletedAt(item.folder.deletedAt, item.folder.updatedAt),
      id: item.folder.id,
      kind: "folder",
      name: item.folder.name,
      originalPathLabel: item.originalPathLabel,
      restoreTargetLabel: item.restoreLocation.pathLabel,
      storageMutationStatus: item.folder.storageMutation?.status,
    };
  }

  return {
    deletedAt: getDeletedAt(item.file.deletedAt, item.file.updatedAt),
    id: item.file.id,
    kind: "file",
    mimeType: item.file.mimeType,
    name: item.file.name,
    originalPathLabel: item.originalPathLabel,
    restoreTargetLabel: item.restoreLocation.pathLabel,
    sizeBytes: item.file.sizeBytes,
    storageMutationStatus: item.file.storageMutation?.status,
  };
}

export function toTrashClientItems(listing: TrashListing): TrashClientItem[] {
  return [...listing.items, ...listing.files].map(toTrashClientItem);
}

export function filterTrashItems(
  items: TrashClientItem[],
  filterType: TrashFilterType,
): TrashClientItem[] {
  if (filterType === "all") return items;
  return items.filter((item) => item.kind === filterType);
}

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortTrashItems(
  items: TrashClientItem[],
  sortOrder: TrashSortOrder,
): TrashClientItem[] {
  const direction = sortOrder === "newest" ? -1 : 1;

  return [...items].sort((left, right) => {
    const deletedAtDelta =
      new Date(left.deletedAt).getTime() - new Date(right.deletedAt).getTime();

    if (deletedAtDelta !== 0) return deletedAtDelta * direction;

    return (
      compareStrings(left.name, right.name) ||
      compareStrings(left.kind, right.kind) ||
      left.id.localeCompare(right.id)
    );
  });
}

export function groupTrashItems<T extends { deletedAt: string }>(
  items: T[],
  sortOrder: TrashSortOrder,
  now: Date,
  timeZone: string,
): TrashGroup<T>[] {
  const map = new Map<TrashGroupLabel, T[]>();

  for (const item of items) {
    const label = getDateGroup(item.deletedAt, now, timeZone);
    map.set(label, [...(map.get(label) ?? []), item]);
  }

  const order =
    sortOrder === "oldest" ? [...DATE_GROUP_ORDER].reverse() : DATE_GROUP_ORDER;

  return order.flatMap((label) => {
    const group = map.get(label);
    return group ? [{ label, items: group }] : [];
  });
}
