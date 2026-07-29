// Folder creation intentionally keeps the common storage mutation response.
// fallow-ignore-file code-duplication
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
import { filesService } from "@/server/files/service";
import { recordFolderAccessBestEffort } from "@/server/retrieval/recent-tracking";
import {
  attachStorageMutationHeader,
  readStorageIdempotencyKey,
} from "@/server/storage-idempotency";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return wantsJson(request)
      ? NextResponse.json(
          { error: "Cross-origin requests are not allowed." },
          { status: 403 },
        )
      : formErrorResponse(
          request,
          "/files",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  const body = await readRequestBody(request);
  const redirectTo = getSafeRedirectTarget(body.redirectTo, "/files");
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  let idempotencyKey: string | null = null;
  try {
    idempotencyKey = readStorageIdempotencyKey(request);
    const result = await filesService.createFolder({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      parentId: body.parentId || null,
      name: body.name,
      idempotencyKey,
    });
    await recordFolderAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: result.folder.id,
      source: "create-folder-route",
    });

    return attachStorageMutationHeader(
      wantsJson(request)
        ? NextResponse.json(result, { status: 201 })
        : redirectWithMessage(
            request,
            redirectTo,
            "success",
            `Created folder ${result.folder.name}.`,
          ),
      idempotencyKey,
      session.user.id,
    );
  } catch (error) {
    return attachStorageMutationHeader(
      wantsJson(request)
        ? jsonErrorResponse(error)
        : formErrorResponse(request, redirectTo, error),
      idempotencyKey ?? request.headers.get("Idempotency-Key"),
      session.user.id,
      error,
    );
  }
}
