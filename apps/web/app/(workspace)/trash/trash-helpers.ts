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

import {
  compareListItems,
  sortWorkspaceItems,
  type WorkspaceSortDirection,
} from "../workspace-item-helpers";

export type TrashClientItem = {
  deletedAt: string;
  id: string;
  kind: "file" | "folder";
  mimeType?: string;
  name: string;
  /** Where it was deleted from. */
  locationLabel: string;
  restoreTargetLabel: string;
  sizeBytes?: number;
  storageMutationStatus?: string;
};

export type TrashFilterType = "all" | "file" | "folder";
export type TrashSortKey = "name" | "path" | "size" | "deletedAt";

export const TRASH_FILTERS: { id: TrashFilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "folder", label: "Folders" },
  { id: "file", label: "Files" },
];

export type TrashGroupLabel = DateGroupLabel;

export type TrashGroup<T> = {
  items: T[];
  label: TrashGroupLabel;
};

function getDeletedAt(value: Date | null, fallback: Date): string {
  return (value ?? fallback).toISOString();
}

// Exported for its unit tests.
// fallow-ignore-next-line unused-export
export function toTrashClientItem(
  item: TrashFolderSummary | TrashFileSummary,
): TrashClientItem {
  if ("folder" in item) {
    return {
      deletedAt: getDeletedAt(item.folder.deletedAt, item.folder.updatedAt),
      id: item.folder.id,
      kind: "folder",
      name: item.folder.name,
      locationLabel: item.originalPathLabel,
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
    locationLabel: item.originalPathLabel,
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

export function sortTrashItems(
  items: TrashClientItem[],
  sortKey: TrashSortKey,
  sortDirection: WorkspaceSortDirection,
): TrashClientItem[] {
  return sortWorkspaceItems(
    items,
    sortDirection,
    compareListItems(sortKey, (item: TrashClientItem) => item.deletedAt),
    { includeKindTieBreak: true },
  );
}

export function groupTrashItems<T extends { deletedAt: string }>(
  items: T[],
  oldestFirst: boolean,
  now: Date,
  timeZone: string,
): TrashGroup<T>[] {
  const map = new Map<TrashGroupLabel, T[]>();

  for (const item of items) {
    const label = getDateGroup(item.deletedAt, now, timeZone);
    map.set(label, [...(map.get(label) ?? []), item]);
  }

  const order = oldestFirst
    ? [...DATE_GROUP_ORDER].reverse()
    : DATE_GROUP_ORDER;

  return order.flatMap((label) => {
    const group = map.get(label);
    return group ? [{ label, items: group }] : [];
  });
}
