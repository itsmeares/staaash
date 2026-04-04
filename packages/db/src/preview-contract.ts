import path from "node:path";

/**
 * The kind of preview asset that can be generated for a file.
 * Drives both the worker generation logic and the delivery route content-type.
 */
export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video";

/** MIME prefix groups mapped to their preview kind. */
const MIME_TO_PREVIEW_KIND: Array<[prefix: string, kind: PreviewKind]> = [
  // Images — thumbnails via sharp
  ["image/", "image"],
  // PDF
  ["application/pdf", "pdf"],
  // Plain text and common text variants
  ["text/", "text"],
  ["application/json", "text"],
  ["application/xml", "text"],
  ["application/x-yaml", "text"],
  ["application/javascript", "text"],
  ["application/typescript", "text"],
  // Audio — metadata via music-metadata
  ["audio/", "audio"],
  // Video — poster frame via ffmpeg
  ["video/", "video"],
];

/**
 * Resolves the preview kind for a given MIME type.
 * Returns null if the MIME type is not previewable.
 */
export const resolvePreviewKind = (mimeType: string): PreviewKind | null => {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  for (const [prefix, kind] of MIME_TO_PREVIEW_KIND) {
    if (normalized === prefix || normalized.startsWith(prefix)) {
      return kind;
    }
  }

  return null;
};

/**
 * The file extension used for each preview asset kind.
 */
export const PREVIEW_ASSET_EXTENSION: Record<PreviewKind, string> = {
  image: ".webp",
  pdf: ".webp",
  text: ".txt",
  audio: ".json",
  video: ".webp",
};

/**
 * The content type returned when serving each preview kind.
 */
export const PREVIEW_ASSET_CONTENT_TYPE: Record<PreviewKind, string> = {
  image: "image/webp",
  pdf: "image/webp",
  text: "text/plain; charset=utf-8",
  audio: "application/json",
  video: "image/webp",
};

/** Storage directory that holds all preview assets (relative to FILES_ROOT). */
const PREVIEWS_DIR = "previews";

/**
 * Returns the storage-key (relative path from FILES_ROOT) for a preview asset.
 * Assets are keyed by file ID — not by logical path — so rename/move/restore
 * never invalidates a ready preview.
 *
 * Layout: previews/<ownerUserId>/<fileId>/<kind><ext>
 */
export const getPreviewAssetStorageKey = (
  ownerUserId: string,
  fileId: string,
  kind: PreviewKind,
): string =>
  path.posix.join(
    PREVIEWS_DIR,
    ownerUserId,
    fileId,
    `${kind}${PREVIEW_ASSET_EXTENSION[kind]}`,
  );

/**
 * Returns the storage-key prefix for all preview assets belonging to a file.
 * Use this to locate and remove the entire preview subtree on hard delete.
 *
 * Layout: previews/<ownerUserId>/<fileId>/
 */
export const getPreviewAssetDirectoryKey = (
  ownerUserId: string,
  fileId: string,
): string => path.posix.join(PREVIEWS_DIR, ownerUserId, fileId);

/** Default maximum source file size for preview generation (25 MB). */
export const DEFAULT_PREVIEW_MAX_SOURCE_BYTES = 26_214_400;

/** Default maximum bytes to excerpt for text previews (64 KB). */
export const DEFAULT_PREVIEW_TEXT_MAX_BYTES = 65_536;

/** Thumbnail width in pixels for image and PDF previews. */
export const PREVIEW_THUMBNAIL_WIDTH = 512;
