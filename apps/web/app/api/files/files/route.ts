import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
  redirectWithMessage,
  wantsJson,
} from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { pairUploadRequestItems, parseUploadManifest } from "@/server/uploads";
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

  const formData = await request.formData();
  const redirectTo = getSafeRedirectTarget(
    String(formData.get("redirectTo") ?? "/files"),
    "/files",
  );
  const session = await getRequestSession(request);

  if (!session) {
    return notSignedInResponse(request, redirectTo);
  }

  let idempotencyKey: string | null = null;
  try {
    idempotencyKey = readStorageIdempotencyKey(request);
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const manifest = parseUploadManifest(
      formData.get("manifest")?.toString() ?? null,
    );
    const result = await filesService.uploadFiles({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: formData.get("folderId")?.toString() ?? null,
      items: pairUploadRequestItems(manifest, files),
      idempotencyKey,
    });
    await Promise.all(
      result.uploadedFiles.map((file) =>
        recordFileAccessBestEffort({
          actorUserId: session.user.id,
          actorRole: session.user.role,
          fileId: file.id,
          source: "upload-files-route",
        }),
      ),
    );

    if (result.conflicts.length > 0) {
      return attachStorageMutationHeader(
        NextResponse.json(
          {
            error:
              "One or more files conflicted with existing names in this folder.",
            code: "FILE_NAME_CONFLICT",
            ...result,
          },
          { status: 409 },
        ),
        `${idempotencyKey}:0`,
        session.user.id,
      );
    }

    if (!wantsJson(request)) {
      const count = result.uploadedFiles.length;
      const response = redirectWithMessage(
        request,
        redirectTo,
        "success",
        `Uploaded ${count} file${count === 1 ? "" : "s"}.`,
      );
      return attachStorageMutationHeader(
        response,
        `${idempotencyKey}:0`,
        session.user.id,
      );
    }

    return attachStorageMutationHeader(
      NextResponse.json(result, { status: 201 }),
      `${idempotencyKey}:0`,
      session.user.id,
    );
  } catch (error) {
    return attachStorageMutationHeader(
      wantsJson(request)
        ? jsonErrorResponse(error)
        : formErrorResponse(request, redirectTo, error),
      idempotencyKey ? `${idempotencyKey}:0` : null,
      session.user.id,
      error,
    );
  }
}
