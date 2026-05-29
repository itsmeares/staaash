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

const TRASH_GROUP_ORDER = [
  "Today",
  "Yesterday",
  "This week",
  "This month",
  "Older",
] as const;

export type TrashGroupLabel = (typeof TRASH_GROUP_ORDER)[number];

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

export function getTrashDateGroup(
  value: Date | string,
  now = new Date(),
): TrashGroupLabel {
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

export function groupTrashItems<T extends { deletedAt: string }>(
  items: T[],
  sortOrder: TrashSortOrder = "newest",
  now = new Date(),
): TrashGroup<T>[] {
  const map = new Map<TrashGroupLabel, T[]>();

  for (const item of items) {
    const label = getTrashDateGroup(item.deletedAt, now);
    map.set(label, [...(map.get(label) ?? []), item]);
  }

  const order =
    sortOrder === "oldest"
      ? [...TRASH_GROUP_ORDER].reverse()
      : TRASH_GROUP_ORDER;

  return order.flatMap((label) => {
    const group = map.get(label);
    return group ? [{ label, items: group }] : [];
  });
}
