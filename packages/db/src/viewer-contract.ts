export type ViewerKind = "image" | "video";

const MIME_TO_VIEWER_KIND: Array<[prefix: string, kind: ViewerKind]> = [
  ["image/", "image"],
  ["video/", "video"],
];

export const resolveViewerKind = (mimeType: string): ViewerKind | null => {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  for (const [prefix, kind] of MIME_TO_VIEWER_KIND) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return kind;
    }
  }

  return null;
};
