import { open } from "node:fs/promises";

import { NextRequest } from "next/server";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse, wantsJson } from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";
import { prismaFilesRepository } from "@/server/files/repository";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { getStoragePath } from "@/server/storage";
import { createRangeResponseFromHandle } from "@/server/downloads/range-response";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

const normalizeDownloadError = (error: unknown) => {
  if (
    error instanceof Error &&
    typeof (error as { status?: unknown }).status === "number" &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    const typedError = error as Error & {
      status: number;
      code: string;
    };

    return {
      status: typedError.status,
      code: typedError.code,
      message: typedError.message,
    };
  }

  return {
    status: 404,
    code: "FILE_NOT_FOUND",
    message:
      error instanceof Error ? error.message : "Unable to download that file.",
  };
};

const isFileUnreadable = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EACCES" || code === "EISDIR";
};

const isMissingStorageObject = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EISDIR";
};

const createDownloadErrorResponse = (error: unknown, request: NextRequest) => {
  const normalized = normalizeDownloadError(error);

  if (wantsJson(request)) {
    return Response.json(
      {
        error: normalized.message,
        code: normalized.code,
      },
      {
        status: normalized.status,
      },
    );
  }

  return new Response(normalized.message, {
    status: normalized.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  const redirectTo = `/api/files/files/${fileId}/download`;
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const file = await prismaFilesRepository.findFileById(fileId);

    if (!file || file.deletedAt) {
      throw new FilesError("FILE_NOT_FOUND");
    }

    if (
      !canAccessPrivateNamespace({
        actorRole: session.user.role,
        actorUserId: session.user.id,
        namespaceOwnerUserId: file.ownerUserId,
      })
    ) {
      throw new FilesError("ACCESS_DENIED");
    }

    const storagePath = getStoragePath(file.storageKey);

    // Open explicitly so the file is proven readable before recording recents.
    let fileHandle;

    try {
      fileHandle = await open(storagePath, "r");
    } catch (openError) {
      if (isMissingStorageObject(openError)) {
        await prismaFilesRepository.markFileStorageMissing(file.id);
      }

      if (isFileUnreadable(openError)) {
        throw new FilesError("FILE_NOT_FOUND");
      }
      throw openError;
    }

    // File is readable — record recents best-effort before streaming.
    await recordFileAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      fileId: file.id,
      source: "download-file-route",
    });

    return createRangeResponseFromHandle(
      request,
      fileHandle,
      file.sizeBytes,
      file.mimeType || "application/octet-stream",
      file.name,
    );
  } catch (error) {
    return createDownloadErrorResponse(error, request);
  }
}
