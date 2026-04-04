import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse } from "@/server/auth/http";
import { LibraryError } from "@/server/library/errors";
import { getAccessiblePrivateFile } from "@/server/library/viewer";
import {
  createInlineOriginalContentResponse,
  createMediaErrorResponse,
  MediaContentError,
} from "@/server/media/content-response";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, `/api/library/files/${fileId}/content`);
  }

  try {
    const file = await getAccessiblePrivateFile({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      fileId,
    });

    return await createInlineOriginalContentResponse({
      request,
      file,
    });
  } catch (error) {
    if (error instanceof LibraryError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (error instanceof MediaContentError) {
      return createMediaErrorResponse(error);
    }

    return Response.json({ error: "Content unavailable." }, { status: 404 });
  }
}
