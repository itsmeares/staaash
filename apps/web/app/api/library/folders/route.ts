import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
  readRequestBody,
  redirectWithMessage,
  wantsJson,
} from "@/server/auth/http";
import { libraryService } from "@/server/library/service";
import { retrievalService } from "@/server/retrieval/service";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/library",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/library");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const result = await libraryService.createFolder({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      parentId: body.parentId || null,
      name: body.name,
    });
    await retrievalService.recordFolderAccess({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: result.folder.id,
    });

    return wantsJson(request)
      ? NextResponse.json(result, { status: 201 })
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          `Created folder ${result.folder.name}.`,
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
