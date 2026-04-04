import { open } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

import { NextRequest } from "next/server";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse } from "@/server/auth/http";
import { LibraryError } from "@/server/library/errors";
import { prismaLibraryRepository } from "@/server/library/repository";
import { getStoragePath } from "@/server/storage";
import {
  PREVIEW_ASSET_CONTENT_TYPE,
  getPreviewAssetStorageKey,
  resolvePreviewKind,
} from "@staaash/db/preview-contract";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, `/api/library/files/${fileId}/preview`);
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

    if (file.previewStatus !== "ready") {
      return Response.json(
        { error: "Preview not available.", code: "PREVIEW_NOT_READY" },
        { status: 404 },
      );
    }

    const previewKind = resolvePreviewKind(file.mimeType);

    if (!previewKind) {
      return Response.json(
        {
          error: "Preview not supported for this file type.",
          code: "PREVIEW_UNSUPPORTED",
        },
        { status: 404 },
      );
    }

    const previewKey = getPreviewAssetStorageKey(
      file.ownerUserId,
      fileId,
      previewKind,
    );
    const previewPath = getStoragePath(previewKey);

    let fileHandle;
    try {
      fileHandle = await open(previewPath, "r");
    } catch {
      return Response.json(
        {
          error: "Preview asset not found on disk.",
          code: "PREVIEW_NOT_FOUND",
        },
        { status: 404 },
      );
    }

    const stat = await fileHandle.stat();
    const nodeStream = fileHandle.createReadStream();

    nodeStream.on("error", (err) => {
      console.error("preview-route: stream error", { fileId, error: err });
    });

    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      headers: {
        "content-type": PREVIEW_ASSET_CONTENT_TYPE[previewKind],
        "content-length": String(stat.size),
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof LibraryError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    return Response.json({ error: "Preview unavailable." }, { status: 404 });
  }
}
