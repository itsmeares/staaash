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

export const isHeicFile = (file: { mimeType: string; name: string }) => {
  const mime = normalizeMimeType(file.mimeType);
  return (
    heicMimeTypes.has(mime) ||
    (!VIEWER_MIME_PREFIXES.some(([prefix]) => mime.startsWith(prefix)) &&
      heicNamePattern.test(file.name))
  );
};

/**
 * Types the viewer can show, for uploads that name none, like the desktop app.
 * Active content (HTML, SVG, scripts) stays out, so a guess never makes a file
 * render differently than its uploader asked.
 */
const EXTENSION_MIME_TYPES = new Map([
  ...HEIC_EXTENSION_MIME_TYPES,
  ["avif", "image/avif"],
  ["bmp", "image/bmp"],
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["avi", "video/x-msvideo"],
  ["m4v", "video/mp4"],
  ["mkv", "video/x-matroska"],
  ["mov", "video/quicktime"],
  ["mp4", "video/mp4"],
  ["ogv", "video/ogg"],
  ["webm", "video/webm"],
  ["aac", "audio/aac"],
  ["flac", "audio/flac"],
  ["m4a", "audio/mp4"],
  ["mp3", "audio/mpeg"],
  ["oga", "audio/ogg"],
  ["ogg", "audio/ogg"],
  ["opus", "audio/ogg"],
  ["wav", "audio/wav"],
  ["pdf", "application/pdf"],
  ["csv", "text/csv"],
  ["log", "text/plain"],
  ["md", "text/markdown"],
  ["txt", "text/plain"],
]);

export const resolveUploadMimeType = (mimeType: string, fileName: string) => {
  const normalized = normalizeMimeType(mimeType);
  if (normalized && normalized !== "application/octet-stream") return mimeType;
  const dot = fileName.lastIndexOf(".");
  const extension = dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
  return (
    EXTENSION_MIME_TYPES.get(extension) ??
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
