import type { ItemVisualKind } from "@/app/item-visuals";
import type { RetrievalItem } from "@/server/retrieval/types";

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

export type RecentFilterType =
  | "all"
  | "archive"
  | "audio"
  | "folder"
  | "image"
  | "pdf"
  | "text"
  | "video";

export type RecentSortKey = "name" | "path" | "size" | "uploadedAt";
export type RecentSortDirection = "asc" | "desc";

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

function splitPathLabel(pathLabel: string): string[] {
  return pathLabel
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getRecentLocationLabel(item: RetrievalItem): string {
  const parts = splitPathLabel(item.pathLabel);
  const pathWithoutSelf =
    parts.at(-1) === item.name ? parts.slice(0, -1) : parts;
  const withoutRoot =
    pathWithoutSelf.length > 1 ? pathWithoutSelf.slice(1) : [];
  return withoutRoot.length > 0 ? withoutRoot.join(" / ") : "/";
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
  if (item.kind === "folder") return "folder";

  const mime = item.mimeType ?? "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.includes("pdf")) return "pdf";
  if (
    mime.startsWith("text/") ||
    mime.includes("typescript") ||
    mime.includes("json") ||
    mime.includes("document")
  ) {
    return "text";
  }
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  ) {
    return "archive";
  }

  return "all";
}

function getRecentVisualKind(
  item: Pick<RecentClientItem, "kind" | "mimeType">,
): ItemVisualKind {
  const type = getRecentType(item);
  return type === "all" ? "file" : type;
}

export function filterRecentItems(
  items: RecentClientItem[],
  filterType: RecentFilterType,
): RecentClientItem[] {
  if (filterType === "all") return items;
  return items.filter((item) => getRecentType(item) === filterType);
}

export function formatRecentFileSize(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatRecentRelativeTime(
  value: Date | string,
  now = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
  });
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

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortRecentItems(
  items: RecentClientItem[],
  sortKey: RecentSortKey,
  sortDirection: RecentSortDirection,
): RecentClientItem[] {
  const direction = sortDirection === "asc" ? 1 : -1;

  return [...items].sort((left, right) => {
    let delta = 0;

    if (sortKey === "name") {
      delta = compareStrings(left.name, right.name);
    } else if (sortKey === "path") {
      delta = compareStrings(left.locationLabel, right.locationLabel);
    } else if (sortKey === "size") {
      delta = (left.sizeBytes ?? -1) - (right.sizeBytes ?? -1);
    } else {
      delta =
        new Date(left.uploadedAt).getTime() -
        new Date(right.uploadedAt).getTime();
    }

    if (delta === 0) {
      delta =
        compareStrings(left.name, right.name) ||
        left.id.localeCompare(right.id);
    }

    return delta * direction;
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
