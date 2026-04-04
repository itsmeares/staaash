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

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/trash",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/trash");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  try {
    const result = await libraryService.clearTrash({
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });
    const folderLabel = `${result.deletedFolderCount} folder tree${
      result.deletedFolderCount === 1 ? "" : "s"
    }`;
    const fileLabel = `${result.deletedFileCount} file${
      result.deletedFileCount === 1 ? "" : "s"
    }`;

    return wantsJson(request)
      ? NextResponse.json(result)
      : redirectWithMessage(
          request,
          redirectTo,
          "success",
          `Emptied trash. Removed ${folderLabel} and ${fileLabel}.`,
        );
  } catch (error) {
    return wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
  }
}
