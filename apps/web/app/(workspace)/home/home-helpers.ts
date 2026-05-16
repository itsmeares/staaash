export type HomeVisualKind =
  | "archive"
  | "audio"
  | "file"
  | "folder"
  | "image"
  | "pdf"
  | "text"
  | "video";

export type HomeItemVisual = {
  kind: HomeVisualKind;
  label: string;
  color: string;
  background: string;
};

const defaultFileVisual: HomeItemVisual = {
  kind: "file",
  label: "File",
  color: "oklch(58% 0.02 76)",
  background: "oklch(58% 0.02 76 / 0.1)",
};

const fileVisuals: Record<Exclude<HomeVisualKind, "folder">, HomeItemVisual> = {
  archive: {
    kind: "archive",
    label: "Archive",
    color: "oklch(58% 0.02 76)",
    background: "oklch(58% 0.02 76 / 0.1)",
  },
  audio: {
    kind: "audio",
    label: "Audio",
    color: "oklch(62% 0.14 145)",
    background: "oklch(62% 0.14 145 / 0.12)",
  },
  file: defaultFileVisual,
  image: {
    kind: "image",
    label: "Image",
    color: "oklch(58% 0.13 255)",
    background: "oklch(58% 0.13 255 / 0.12)",
  },
  pdf: {
    kind: "pdf",
    label: "PDF",
    color: "oklch(62% 0.16 45)",
    background: "oklch(62% 0.16 45 / 0.12)",
  },
  text: {
    kind: "text",
    label: "Text",
    color: "oklch(66% 0.12 78)",
    background: "oklch(66% 0.12 78 / 0.12)",
  },
  video: {
    kind: "video",
    label: "Video",
    color: "oklch(58% 0.14 300)",
    background: "oklch(58% 0.14 300 / 0.12)",
  },
};

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

export function getHomeItemVisual(
  kind: "file" | "folder",
  mimeType?: string | null,
): HomeItemVisual {
  if (kind === "folder") {
    return {
      kind: "folder",
      label: "Folder",
      color: "color-mix(in oklab, var(--primary) 78%, var(--foreground) 22%)",
      background: "color-mix(in oklab, var(--primary) 10%, transparent)",
    };
  }

  const mime = mimeType ?? "";

  if (mime.startsWith("image/")) return fileVisuals.image;
  if (mime.startsWith("video/")) return fileVisuals.video;
  if (mime.startsWith("audio/")) return fileVisuals.audio;
  if (mime.includes("pdf")) return fileVisuals.pdf;
  if (mime.startsWith("text/") || mime.includes("typescript"))
    return fileVisuals.text;
  if (mime.includes("zip") || mime.includes("tar")) return fileVisuals.archive;

  return defaultFileVisual;
}
