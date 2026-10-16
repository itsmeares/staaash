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

export type TrashSortKey = "name" | "path" | "size" | "deletedAt";

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
