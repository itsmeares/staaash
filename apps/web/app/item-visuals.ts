export type ItemVisualKind =
  | "archive"
  | "audio"
  | "file"
  | "folder"
  | "image"
  | "pdf"
  | "text"
  | "video";

export type ItemVisual = {
  kind: ItemVisualKind;
  label: string;
  color: string;
  background: string;
};

const defaultFileVisual: ItemVisual = {
  kind: "file",
  label: "File",
  color: "oklch(58% 0.02 76)",
  background: "oklch(58% 0.02 76 / 0.1)",
};

const fileVisuals: Record<Exclude<ItemVisualKind, "folder">, ItemVisual> = {
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

export function getItemVisual(
  kind: "file" | "folder",
  mimeType?: string | null,
): ItemVisual {
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
  if (
    mime.startsWith("text/") ||
    mime.includes("typescript") ||
    mime.includes("json") ||
    mime.includes("document")
  )
    return fileVisuals.text;
  if (
    mime.includes("zip") ||
    mime.includes("archive") ||
    mime.includes("tar") ||
    mime.includes("gzip")
  )
    return fileVisuals.archive;

  return defaultFileVisual;
}
