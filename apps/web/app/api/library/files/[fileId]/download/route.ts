import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { NextRequest } from "next/server";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse, wantsJson } from "@/server/auth/http";
import { LibraryError } from "@/server/library/errors";
import { prismaLibraryRepository } from "@/server/library/repository";
import { retrievalService } from "@/server/retrieval/service";
import { getStoragePath } from "@/server/storage";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

const buildAttachmentDisposition = (fileName: string) =>
  `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`;

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
  const redirectTo = `/api/library/files/${fileId}/download`;
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const file = await prismaLibraryRepository.findFileById(fileId);

    if (!file || file.deletedAt) {
      throw new LibraryError("FILE_NOT_FOUND");
    }

    if (
      !canAccessPrivateNamespace({
        actorRole: session.user.role,
        actorUserId: session.user.id,
        namespaceOwnerUserId: file.ownerUserId,
      })
    ) {
      throw new LibraryError("ACCESS_DENIED");
    }

    await retrievalService.recordFileAccess({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      fileId: file.id,
    });

    return new Response(
      Readable.toWeb(
        createReadStream(getStoragePath(file.storageKey)),
      ) as ReadableStream,
      {
        headers: {
          "content-disposition": buildAttachmentDisposition(file.name),
          "content-length": String(file.sizeBytes),
          "content-type": file.mimeType || "application/octet-stream",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    return createDownloadErrorResponse(error, request);
  }
}
