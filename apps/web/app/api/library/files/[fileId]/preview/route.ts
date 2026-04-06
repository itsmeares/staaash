import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse } from "@/server/auth/http";
import { LibraryError } from "@/server/library/errors";
import { getAccessiblePrivateFile } from "@/server/library/viewer";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  const session = await getRequestSession(request);
  const redirectTarget = `/api/library/files/${fileId}/content`;

  if (!session) {
    return notSignedInResponse(request, redirectTarget);
  }

  try {
    const file = await getAccessiblePrivateFile({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      fileId,
    });

    if (!file.viewerKind) {
      return Response.json(
        {
          error: "Preview not supported for this file type.",
          code: "PREVIEW_UNSUPPORTED",
        },
        { status: 404 },
      );
    }

    return Response.redirect(new URL(redirectTarget, request.url), 307);
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
