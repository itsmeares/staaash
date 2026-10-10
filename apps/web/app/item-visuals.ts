export type ItemVisualKind =
  "archive" | "audio" | "file" | "folder" | "image" | "pdf" | "text" | "video";

export type ItemVisual = {
  kind: ItemVisualKind;
  label: string;
  color: string;
  background: string;
};

const defaultFileVisual: ItemVisual = {
  kind: "file",
  label: "File",
  color: "var(--file-doc)",
  background: "color-mix(in oklab, var(--file-doc) 12%, transparent)",
};

const fileVisuals: Record<Exclude<ItemVisualKind, "folder">, ItemVisual> = {
  archive: {
    kind: "archive",
    label: "Archive",
    color: "var(--file-doc)",
    background: "color-mix(in oklab, var(--file-doc) 12%, transparent)",
  },
  audio: {
    kind: "audio",
    label: "Audio",
    color: "var(--file-audio)",
    background: "color-mix(in oklab, var(--file-audio) 12%, transparent)",
  },
  file: defaultFileVisual,
  image: {
    kind: "image",
    label: "Image",
    color: "var(--file-image)",
    background: "color-mix(in oklab, var(--file-image) 12%, transparent)",
  },
  pdf: {
    kind: "pdf",
    label: "PDF",
    color: "var(--file-pdf)",
    background: "color-mix(in oklab, var(--file-pdf) 12%, transparent)",
  },
  text: {
    kind: "text",
    label: "Text",
    color: "var(--file-doc)",
    background: "color-mix(in oklab, var(--file-doc) 12%, transparent)",
  },
  video: {
    kind: "video",
    label: "Video",
    color: "var(--file-video)",
    background: "color-mix(in oklab, var(--file-video) 12%, transparent)",
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
      color: "var(--muted-foreground)",
      background: "color-mix(in oklab, var(--foreground) 6%, transparent)",
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
