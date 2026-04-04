import { open } from "node:fs/promises";
import { Readable } from "node:stream";

import { getStoragePath } from "@/server/storage";
import { ShareError, isShareError } from "@/server/sharing/errors";
import type { StoredLibraryFile } from "@/server/library/types";
import {
  PREVIEW_ASSET_CONTENT_TYPE,
  getPreviewAssetStorageKey,
  resolvePreviewKind,
} from "@staaash/db/preview-contract";

export const createPreviewResponse = async (
  file: StoredLibraryFile,
): Promise<Response> => {
  if (file.previewStatus !== "ready") {
    return new Response("Preview not available.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const previewKind = resolvePreviewKind(file.mimeType);

  if (!previewKind) {
    return new Response("Preview not supported for this file type.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const previewKey = getPreviewAssetStorageKey(
    file.ownerUserId,
    file.id,
    previewKind,
  );
  const previewPath = getStoragePath(previewKey);

  let fileHandle;
  try {
    fileHandle = await open(previewPath, "r");
  } catch {
    return new Response("Preview asset not found.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const stat = await fileHandle.stat();
  const nodeStream = fileHandle.createReadStream();

  nodeStream.on("error", (err) => {
    console.error("share-preview: stream error", {
      fileId: file.id,
      error: err,
    });
  });

  return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
    headers: {
      "content-type": PREVIEW_ASSET_CONTENT_TYPE[previewKind],
      "content-length": String(stat.size),
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
};

export const createSharePreviewErrorResponse = (error: unknown): Response => {
  const normalized = isShareError(error)
    ? error
    : new ShareError("SHARE_INVALID");

  return new Response(normalized.message, {
    status: normalized.status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
