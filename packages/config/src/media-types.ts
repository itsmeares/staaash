export type ViewerKind = "image" | "video" | "audio" | "pdf" | "text";

export const VIEWER_MIME_PREFIXES: Array<[prefix: string, kind: ViewerKind]> = [
  ["image/", "image"],
  ["video/", "video"],
  ["audio/", "audio"],
  ["application/pdf", "pdf"],
  ["text/", "text"],
];

const HEIC_EXTENSION_MIME_TYPES = new Map([
  ["heic", "image/heic"],
  ["heif", "image/heif"],
]);
export const HEIC_NAME_PATTERN = `[.](${[...HEIC_EXTENSION_MIME_TYPES.keys()].join("|")})$`;
const heicNamePattern = new RegExp(HEIC_NAME_PATTERN, "i");
const heicMimeTypes = new Set([
  ...HEIC_EXTENSION_MIME_TYPES.values(),
  "image/heic-sequence",
  "image/heif-sequence",
]);

export const normalizeMimeType = (mimeType: string) =>
  mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

export const isHeicFile = (file: { mimeType: string; name: string }) =>
  heicMimeTypes.has(normalizeMimeType(file.mimeType)) ||
  heicNamePattern.test(file.name);

export const resolveUploadMimeType = (mimeType: string, fileName: string) => {
  const normalized = normalizeMimeType(mimeType);
  if (normalized && normalized !== "application/octet-stream") return mimeType;
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return (
    HEIC_EXTENSION_MIME_TYPES.get(extension) ??
    (normalized ? mimeType : "application/octet-stream")
  );
};

export const resolveViewerKind = (
  mimeType: string,
  fileName?: string,
): ViewerKind | null => {
  const normalized = normalizeMimeType(mimeType);

  for (const [prefix, kind] of VIEWER_MIME_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return kind;
    }
  }

  if (fileName && heicNamePattern.test(fileName)) return "image";

  return null;
};

/**
 * Files that get a small thumbnail: photos (HEIC too) and video frames.
 * SVG is left out because it can carry scripts and FFmpeg cannot draw it.
 */
export const canHaveThumbnail = (mimeType: string, fileName?: string) => {
  const kind = resolveViewerKind(mimeType, fileName);
  return (
    // Audio counts for its embedded album art; files without one settle as
    // failed once and keep their icon.
    (kind === "image" || kind === "video" || kind === "audio") &&
    !normalizeMimeType(mimeType).startsWith("image/svg")
  );
};
