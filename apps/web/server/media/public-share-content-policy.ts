import type { FileSummary } from "@/server/files/types";

import { isHeicFile } from "./heic-converter";

const MIME_TOKEN = "[!#$%&'*+\\-.^_`|~0-9A-Za-z]+";
const MIME_QUOTED_VALUE = '"(?:[\\t !#-\\[\\]-~]|\\\\[\\t !-~])*"';
const MIME_TYPE_PATTERN = new RegExp(
  `^(${MIME_TOKEN})/(${MIME_TOKEN})(?:[\\t ]*;[\\t ]*${MIME_TOKEN}[\\t ]*=[\\t ]*(?:${MIME_TOKEN}|${MIME_QUOTED_VALUE}))*[\\t ]*$`,
);

const PUBLIC_SHARE_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; form-action 'none'; base-uri 'none'";

// PDF remains inline only under the mandatory bare sandbox above. No allow-*
// sandbox permissions are granted to any public shared content response.
const PUBLIC_SHARE_SAFE_INLINE_MIME_TYPES = [
  "application/pdf",
  "audio/flac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "video/mp4",
  "video/ogg",
  "video/webm",
] as const;

const safeInlineMimeTypes = new Set<string>(
  PUBLIC_SHARE_SAFE_INLINE_MIME_TYPES,
);

const buildContentDisposition = (
  disposition: "attachment" | "inline",
  fileName: string,
) => `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`;

const normalizePublicShareMimeType = (mimeType: string): string | null => {
  if (!mimeType || /[\r\n]/u.test(mimeType)) return null;

  const match = MIME_TYPE_PATTERN.exec(mimeType.trim());
  if (!match?.[1] || !match[2]) return null;

  return `${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
};

export const getPublicShareSafeInlineMimeType = (
  mimeType: string,
): string | null => {
  const normalized = normalizePublicShareMimeType(mimeType);
  return normalized !== null && safeInlineMimeTypes.has(normalized)
    ? normalized
    : null;
};

const isPublicShareMimeSafeInline = (mimeType: string): boolean =>
  getPublicShareSafeInlineMimeType(mimeType) !== null;

export const getPublicShareResponseMimeType = (mimeType: string): string =>
  normalizePublicShareMimeType(mimeType) ?? "application/octet-stream";

export const isPublicShareFileNativeViewSafe = (
  file: Pick<FileSummary, "mimeType" | "name" | "viewerKind">,
  preview?: { safeInlineMimeType: string | null } | null,
): boolean => {
  if (file.viewerKind === "video" && preview) {
    return (
      preview.safeInlineMimeType !== null &&
      isPublicShareMimeSafeInline(preview.safeInlineMimeType)
    );
  }

  const emittedMimeType =
    file.viewerKind === "image" && isHeicFile(file)
      ? "image/jpeg"
      : getPublicShareResponseMimeType(file.mimeType);

  return isPublicShareMimeSafeInline(emittedMimeType);
};

const createPublicShareContentHeaders = ({
  emittedMimeType,
  fileName,
}: {
  emittedMimeType: string;
  fileName: string;
}) => {
  const safeInlineMimeType = getPublicShareSafeInlineMimeType(emittedMimeType);

  return {
    "content-disposition": buildContentDisposition(
      safeInlineMimeType ? "inline" : "attachment",
      fileName,
    ),
    "content-security-policy": PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
    "content-type": safeInlineMimeType ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  };
};

export const applyPublicShareContentPolicy = (
  response: Response,
  fileName: string,
): Response => {
  const policyHeaders = createPublicShareContentHeaders({
    emittedMimeType:
      response.headers.get("content-type") ?? "application/octet-stream",
    fileName,
  });

  for (const [name, value] of Object.entries(policyHeaders)) {
    response.headers.set(name, value);
  }

  return response;
};

export const isPublicShareResponseAttachment = (response: Response): boolean =>
  response.headers
    .get("content-disposition")
    ?.toLowerCase()
    .startsWith("attachment;") ?? true;
