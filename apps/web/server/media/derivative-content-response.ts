import { open } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import {
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_PROFILE_1080P,
  DERIVATIVE_STATUS_FAILED,
  DERIVATIVE_STATUS_PROCESSING,
  DERIVATIVE_STATUS_QUEUED,
  DERIVATIVE_STATUS_READY,
  DERIVATIVE_STATUS_STALE,
  scheduleDerivativeGenerate,
  touchDerivativeViewed,
} from "@staaash/db/media-derivatives";

import { getSystemSettings } from "@/server/settings";
import { getStoragePath } from "@/server/storage";
import type { StoredFile } from "@/server/files/types";
import {
  MediaContentError,
  createInlineOriginalContentResponse,
} from "./content-response";

type DerivativeRow = {
  id: string;
  storageKey: string | null;
  sizeBytes: bigint | null;
  mimeType: string | null;
  status: string;
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

const buildInlineDisposition = (fileName: string) =>
  `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;

const parseSingleByteRange = (
  rangeHeader: string,
  size: number,
): { start: number; end: number } | null => {
  if (!rangeHeader.startsWith("bytes=")) return null;
  const part = rangeHeader.slice("bytes=".length).trim();
  if (!part || part.includes(",")) return null;
  const [s, e] = part.split("-", 2);
  if (s === undefined || e === undefined) return null;
  if (s === "") {
    const suffix = Number(e);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    return { start: Math.max(size - suffix, 0), end: size - 1 };
  }
  const start = Number(s);
  if (!Number.isFinite(start) || start < 0 || start >= size) return null;
  const end = e === "" ? size - 1 : Math.min(Number(e), size - 1);
  if (!Number.isFinite(end) || end < start) return null;
  return { start, end };
};

const serveDerivativeBytes = async (
  request: Request,
  storageKey: string,
  sizeBytes: number,
  mimeType: string,
  fileName: string,
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
      "cache-control": "private, max-age=0, must-revalidate",
      "content-disposition": buildInlineDisposition(fileName),
      "content-type": mimeType,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
    };

    const createStream = (options?: { start: number; end: number }) => {
      const nodeStream = fileHandle!.createReadStream({
        ...options,
        highWaterMark: 512 * 1024,
      });
      nodeStream.on("close", () => {
        fileHandle!.close().catch(() => {});
      });
      return nodeStream;
    };

    if (!rangeHeader) {
      return new Response(createStream() as unknown as BodyInit, {
        status: 200,
        headers: { ...baseHeaders, "content-length": String(sizeBytes) },
      });
    }

    const range = parseSingleByteRange(rangeHeader, sizeBytes);
    if (!range) {
      await fileHandle.close();
      return new Response("Range not satisfiable.", {
        status: 416,
        headers: {
          "content-range": `bytes */${sizeBytes}`,
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const { start, end } = range;
    const contentLength = end - start + 1;

    return new Response(createStream({ start, end }) as unknown as BodyInit, {
      status: 206,
      headers: {
        ...baseHeaders,
        "content-length": String(contentLength),
        "content-range": `bytes ${start}-${end}/${sizeBytes}`,
      },
    });
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
  derivative: Pick<DerivativeRow, "storageKey" | "sizeBytes" | "mimeType">;
  fileName: string;
}): Promise<Response> => {
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

  const derivative = await findReadyDerivativeForFile(file.id);

  if (derivative?.storageKey && derivative.sizeBytes !== null) {
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
          settings.mediaPreviewEnabled &&
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
