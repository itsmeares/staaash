import {
  getItemVisual,
  type ItemVisual as HomeItemVisual,
} from "@/app/item-visuals";

export type { HomeItemVisual };

export function getHomeGreeting(hour: number): string {
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export function formatHomeRelativeTime(
  value: Date | string,
  now = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60)
    return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24)
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en", {
    day: "numeric",
    month: "short",
  });
}

export function formatHomeExpiryTime(
  value: Date | string,
  now = new Date(),
): string {
  const date = value instanceof Date ? value : new Date(value);
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return "expired";

  const diffMinutes = Math.ceil(diffMs / 60000);
  if (diffMinutes < 60)
    return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"}`;

  const diffHours = Math.ceil(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"}`;

  const diffDays = Math.ceil(diffHours / 24);
  if (diffDays < 7) return `${diffDays} days`;

  const diffWeeks = Math.ceil(diffDays / 7);
  if (diffWeeks < 9) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"}`;

  const diffMonths = Math.ceil(diffDays / 30);
  return `${diffMonths} month${diffMonths === 1 ? "" : "s"}`;
}

export function formatHomeFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatHomeChildCount(count: number): string {
  if (count === 0) return "Empty";
  if (count === 1) return "1 item";
  return `${count} items`;
}

export function isHomeDashboardEmpty({
  favoriteCount,
  folderCount,
  recentCount,
  shareCount,
}: {
  favoriteCount: number;
  folderCount: number;
  recentCount: number;
  shareCount: number;
}): boolean {
  return (
    favoriteCount === 0 &&
    folderCount === 0 &&
    recentCount === 0 &&
    shareCount === 0
  );
}

export function getHomeItemVisual(
  kind: "file" | "folder",
  mimeType?: string | null,
): HomeItemVisual {
  return getItemVisual(kind, mimeType);
}
