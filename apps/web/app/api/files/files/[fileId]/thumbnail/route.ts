import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse } from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";
import { getAccessiblePrivateFile } from "@/server/files/viewer";
import {
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";
import { createThumbnailResponse } from "@/server/media/derivative-content-response";
import {
  createStorageEntityUnavailableResponse,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, `/api/files/files/${fileId}/thumbnail`);
  }

  try {
    const file = await getAccessiblePrivateFile({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      fileId,
    });

    return await createThumbnailResponse({
      request,
      file,
    });
  } catch (error) {
    if (error instanceof StorageEntityUnavailableError) {
      return createStorageEntityUnavailableResponse(error);
    }
    if (error instanceof FilesError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }

    return Response.json({ error: "Thumbnail unavailable." }, { status: 404 });
  }
}
