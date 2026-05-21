import type { ItemVisualKind } from "@/app/item-visuals";
import type { FavoriteRetrievalItem } from "@/server/retrieval/types";

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
  sizeBytes?: number;
};

export type FavoriteFilterType =
  | "all"
  | "archive"
  | "audio"
  | "folder"
  | "image"
  | "pdf"
  | "text"
  | "video";

export type FavoriteSortKey = "favoritedAt" | "name" | "path" | "size";
export type FavoriteSortDirection = "asc" | "desc";

function splitPathLabel(pathLabel: string): string[] {
  return pathLabel
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function getFavoriteLocationLabel(item: FavoriteRetrievalItem): string {
  const parts = splitPathLabel(item.pathLabel);
  const pathWithoutSelf =
    parts.at(-1) === item.name ? parts.slice(0, -1) : parts;
  const withoutRoot =
    pathWithoutSelf.length > 1 ? pathWithoutSelf.slice(1) : [];
  return withoutRoot.length > 0 ? withoutRoot.join(" / ") : "/";
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
    sizeBytes: item.kind === "file" ? item.sizeBytes : undefined,
  };
}

export function getFavoriteType(
  item: Pick<FavoriteClientItem, "kind" | "mimeType">,
): FavoriteFilterType {
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

export function getFavoriteVisualKind(
  item: Pick<FavoriteClientItem, "kind" | "mimeType">,
): ItemVisualKind {
  const type = getFavoriteType(item);
  return type === "all" ? "file" : type;
}

export function filterFavoriteItems(
  items: FavoriteClientItem[],
  filterType: FavoriteFilterType,
): FavoriteClientItem[] {
  if (filterType === "all") return items;
  return items.filter((item) => getFavoriteType(item) === filterType);
}

export function formatFavoriteFileSize(bytes?: number): string {
  if (bytes == null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatFavoriteRelativeTime(
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

function compareStrings(left: string, right: string): number {
  return left.localeCompare(right, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortFavoriteItems(
  items: FavoriteClientItem[],
  sortKey: FavoriteSortKey,
  sortDirection: FavoriteSortDirection,
): FavoriteClientItem[] {
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
        new Date(left.favoritedAt).getTime() -
        new Date(right.favoritedAt).getTime();
    }

    if (delta === 0) {
      delta =
        compareStrings(left.name, right.name) ||
        left.kind.localeCompare(right.kind) ||
        left.id.localeCompare(right.id);
    }

    return delta * direction;
  });
}

export function getQuickAccessFavorites(
  items: FavoriteClientItem[],
): FavoriteClientItem[] {
  return sortFavoriteItems(items, "favoritedAt", "desc").slice(0, 3);
}
