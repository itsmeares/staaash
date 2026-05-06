export type ViewerKind = "image" | "video" | "audio" | "pdf" | "text";

const MIME_TO_VIEWER_KIND: Array<[prefix: string, kind: ViewerKind]> = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["application/pdf", "pdf"],
  ["text/", "text"],
];

const EXTENSION_TO_VIEWER_KIND: Record<string, ViewerKind> = {
  heic: "image",
  heif: "image",
};

export const resolveViewerKind = (
  mimeType: string,
  fileName?: string,
): ViewerKind | null => {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  for (const [prefix, kind] of MIME_TO_VIEWER_KIND) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return kind;
    }
  }

  if (fileName) {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext && ext in EXTENSION_TO_VIEWER_KIND) {
      return EXTENSION_TO_VIEWER_KIND[ext]!;
    }
  }

  return null;
};
