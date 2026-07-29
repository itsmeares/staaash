// Folder mutation routes intentionally share one HTTP mutation contract.
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

type RouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

export async function POST(request: NextRequest, { params }: RouteContext) {
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
    const { folderId } = await params;
    const result = await filesService.renameFolder({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
      name: body.name,
      idempotencyKey,
    });
    await recordFolderAccessBestEffort({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId,
      source: "rename-folder-route",
    });

    return attachStorageMutationHeader(
      wantsJson(request)
        ? NextResponse.json(result)
        : redirectWithMessage(
            request,
            redirectTo,
            "success",
            `Renamed folder to ${result.folder.name}.`,
          ),
      idempotencyKey,
    );
  } catch (error) {
    return attachStorageMutationHeader(
      wantsJson(request)
        ? jsonErrorResponse(error)
        : formErrorResponse(request, redirectTo, error),
      idempotencyKey ?? request.headers.get("Idempotency-Key"),
      error,
    );
  }
}
