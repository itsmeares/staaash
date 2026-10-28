import { contentDisposition } from "@/server/downloads/content-disposition";
import { open } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import {
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_KIND_THUMBNAIL,
  DERIVATIVE_PROFILE_1080P,
  DERIVATIVE_PROFILE_THUMB,
  DERIVATIVE_STATUS_FAILED,
  DERIVATIVE_STATUS_PROCESSING,
  DERIVATIVE_STATUS_QUEUED,
  DERIVATIVE_STATUS_READY,
  DERIVATIVE_STATUS_STALE,
  canHaveThumbnail,
  scheduleDerivativeGenerate,
  touchDerivativeViewed,
} from "@staaash/db/media-derivatives";

import { getSystemSettings } from "@/server/settings";
import { getStoragePath } from "@/server/storage";
import type { StoredFile } from "@/server/files/types";
import { assertStorageEntityReadable } from "@/server/storage-read-guard";
import { shouldGenerateMediaPreview } from "./preview-generation-policy";
import {
  INLINE_MEDIA_OPEN_ENDED_RANGE_BYTES,
  MediaContentError,
  createInlineOriginalContentResponse,
  parseSingleByteRange,
} from "./content-response";
import { respondWithFile } from "@/server/downloads/range-response";

type DerivativeRow = {
  id: string;
  storageKey: string | null;
  sizeBytes: bigint | null;
  mimeType: string | null;
  status: string;
  lastViewedAt?: Date | null;
  storageRevision?: number;
  generatedAt?: Date | null;
};

type DbClient = {
  mediaDerivative: {
    findFirst(args: object): Promise<DerivativeRow | null>;
  };
};

const findReadyDerivativeForFile = async (
  fileId: string,
): Promise<DerivativeRow | null> => {
  const db = getPrisma() as unknown as DbClient;
  return db.mediaDerivative.findFirst({
    where: {
      fileId,
      kind: DERIVATIVE_KIND_PREVIEW,
      profile: DERIVATIVE_PROFILE_1080P,
      status: DERIVATIVE_STATUS_READY,
      storageKey: { not: null },
    } as object,
  });
};

const findDerivativeStatus = async (fileId: string): Promise<string | null> => {
  const db = getPrisma() as unknown as DbClient;
  const row = await db.mediaDerivative.findFirst({
    where: {
      fileId,
      kind: DERIVATIVE_KIND_PREVIEW,
      profile: DERIVATIVE_PROFILE_1080P,
    } as object,
  });
  return row?.status ?? null;
};

const serveDerivativeBytes = async (
  request: Request,
  storageKey: string,
  sizeBytes: number,
  mimeType: string,
  fileName: string,
  cacheControl = "private, max-age=0, must-revalidate",
): Promise<Response | null> => {
  const storagePath = getStoragePath(storageKey);
  let fileHandle;

  try {
    fileHandle = await open(storagePath, "r");
  } catch {
    return null;
  }

  try {
    const rangeHeader = request.headers.get("range");
    const baseHeaders: Record<string, string> = {
      "cache-control": cacheControl,
      "content-disposition": contentDisposition("inline", fileName),
      "content-type": mimeType,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
    };

    const parseRange = (header: string) => {
      try {
        return parseSingleByteRange(header, sizeBytes, {
          openEndedRangeBytes: mimeType.toLowerCase().startsWith("video/")
            ? INLINE_MEDIA_OPEN_ENDED_RANGE_BYTES
            : undefined,
        });
      } catch {
        return null;
      }
    };

    return respondWithFile(
      fileHandle,
      sizeBytes,
      baseHeaders,
      rangeHeader ? parseRange(rangeHeader) : undefined,
      request.signal,
    );
  } catch (error) {
    try {
      await fileHandle.close();
    } catch {
      // ignore
    }
    throw error;
  }
};

export const createReadyDerivativeContentResponse = async ({
  request,
  derivative,
  fileName,
}: {
  request: Request;
  derivative: Pick<
    DerivativeRow,
    "id" | "storageKey" | "sizeBytes" | "mimeType"
  >;
  fileName: string;
}): Promise<Response> => {
  await assertStorageEntityReadable("derivative", derivative.id);
  if (!derivative.storageKey || derivative.sizeBytes === null) {
    throw new MediaContentError(404, "Derivative content is unavailable.");
  }

  const response = await serveDerivativeBytes(
    request,
    derivative.storageKey,
    Number(derivative.sizeBytes),
    derivative.mimeType ?? "application/octet-stream",
    fileName,
  );

  if (!response) {
    throw new MediaContentError(404, "Derivative content is unavailable.");
  }

  return response;
};

// Ranged, full, and refused inline responses each answer differently.
// fallow-ignore-next-line complexity
export const createInlineContentResponse = async ({
  request,
  file,
}: {
  request: Request;
  file: StoredFile;
}): Promise<Response> => {
  if (file.viewerKind !== "video") {
    return createInlineOriginalContentResponse({ request, file });
  }
  await assertStorageEntityReadable("file", file.id);

  const derivative = await findReadyDerivativeForFile(file.id);

  if (derivative?.storageKey && derivative.sizeBytes !== null) {
    await assertStorageEntityReadable("derivative", derivative.id);
    const response = await serveDerivativeBytes(
      request,
      derivative.storageKey,
      Number(derivative.sizeBytes),
      derivative.mimeType ?? "application/octet-stream",
      file.name,
    );

    if (response) {
      void touchDerivativeViewed(derivative.id, new Date()).catch(() => {});
      return response;
    }
  }

  const status = derivative
    ? derivative.status
    : await findDerivativeStatus(file.id);

  const isActiveJob =
    status === DERIVATIVE_STATUS_QUEUED ||
    status === DERIVATIVE_STATUS_PROCESSING;

  if (
    !isActiveJob &&
    status !== DERIVATIVE_STATUS_FAILED &&
    status !== DERIVATIVE_STATUS_STALE
  ) {
    void (async () => {
      try {
        const settings = await getSystemSettings();
        if (
          shouldGenerateMediaPreview(settings, "first-view") &&
          BigInt(file.sizeBytes) >= settings.mediaPreviewThresholdBytes
        ) {
          await scheduleDerivativeGenerate({
            fileId: file.id,
            reason: "first-view",
          });
        }
      } catch {
        // best-effort
      }
    })();
  }

  return createInlineOriginalContentResponse({ request, file });
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The small JPEG lists and the details panel show. When it does not exist
 * yet it is queued (under the first-view preview setting) and this answers
 * 404, so the page keeps its type icon until the next visit.
 */
// Settings, eligibility, ready, queued and failed thumbnails each answer differently.
// fallow-ignore-next-line complexity
export const createThumbnailResponse = async ({
  request,
  file,
}: {
  request: Request;
  file: StoredFile;
}): Promise<Response> => {
  if (!canHaveThumbnail(file.mimeType, file.name)) {
    throw new MediaContentError(404, "This file has no thumbnail.");
  }
  await assertStorageEntityReadable("file", file.id);

  const db = getPrisma() as unknown as DbClient;
  const thumbnail = await db.mediaDerivative.findFirst({
    where: {
      fileId: file.id,
      kind: DERIVATIVE_KIND_THUMBNAIL,
      profile: DERIVATIVE_PROFILE_THUMB,
    } as object,
  });

  if (
    thumbnail?.status === DERIVATIVE_STATUS_READY &&
    thumbnail.storageKey &&
    thumbnail.sizeBytes !== null
  ) {
    await assertStorageEntityReadable("derivative", thumbnail.id);
    // The URL stays the same when a file is replaced, so the browser checks
    // back each time; a match costs a 304 with no bytes. Vary keeps one
    // account's cached thumbnail from another account in the same browser.
    const etag = `"${thumbnail.id}.${thumbnail.storageRevision ?? 0}.${thumbnail.generatedAt?.getTime() ?? 0}"`;
    const cacheHeaders = {
      "cache-control": "private, no-cache",
      etag,
      vary: "Cookie, Authorization",
    };
    const response =
      request.headers.get("if-none-match") === etag
        ? new Response(null, { status: 304, headers: cacheHeaders })
        : await serveDerivativeBytes(
            request,
            thumbnail.storageKey,
            Number(thumbnail.sizeBytes),
            thumbnail.mimeType ?? "image/jpeg",
            `${file.name}.jpg`,
            cacheHeaders["cache-control"],
          );
    if (response) {
      response.headers.set("etag", etag);
      response.headers.set("vary", cacheHeaders.vary);
      const now = new Date();
      // Keeps it from retention cleanup without a write on every request.
      if (
        !thumbnail.lastViewedAt ||
        now.getTime() - thumbnail.lastViewedAt.getTime() > DAY_MS
      ) {
        void touchDerivativeViewed(thumbnail.id, now).catch(() => {});
      }
      return response;
    }
  }

  const settled =
    thumbnail?.status === DERIVATIVE_STATUS_QUEUED ||
    thumbnail?.status === DERIVATIVE_STATUS_PROCESSING ||
    thumbnail?.status === DERIVATIVE_STATUS_FAILED;
  if (!settled) {
    const settings = await getSystemSettings();
    if (shouldGenerateMediaPreview(settings, "first-view")) {
      await scheduleDerivativeGenerate({
        fileId: file.id,
        kind: DERIVATIVE_KIND_THUMBNAIL,
        profile: DERIVATIVE_PROFILE_THUMB,
        reason: "first-view",
      });
    }
  }
  throw new MediaContentError(404, "Thumbnail not ready.", {
    headers: { "cache-control": "no-store" },
  });
};
