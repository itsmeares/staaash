import { NextRequest, NextResponse } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import {
  formErrorResponse,
  getSafeRedirectTarget,
  isSameOrigin,
  notSignedInResponse,
  redirectWithMessage,
  wantsJson,
} from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { pairUploadRequestItems, parseUploadManifest } from "@/server/uploads";
import { getPrisma } from "@staaash/db/client";
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
    const firstMutation = await getPrisma().storageMutation.findUnique({
      where: { idempotencyKey: `${idempotencyKey}:0` },
      select: { id: true },
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
      return NextResponse.json(
        {
          error:
            "One or more files conflicted with existing names in this folder.",
          code: "FILE_NAME_CONFLICT",
          ...result,
        },
        {
          status: 409,
          headers: firstMutation
            ? { "X-Storage-Mutation-Id": firstMutation.id }
            : undefined,
        },
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
      if (firstMutation) {
        response.headers.set("X-Storage-Mutation-Id", firstMutation.id);
      }
      return response;
    }

    return NextResponse.json(result, {
      status: 201,
      headers: firstMutation
        ? { "X-Storage-Mutation-Id": firstMutation.id }
        : undefined,
    });
  } catch (error) {
    return attachStorageMutationHeader(
      wantsJson(request)
        ? NextResponse.json(
            {
              error:
                error instanceof Error
                  ? error.message
                  : "Unexpected server error.",
              code:
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                typeof error.code === "string"
                  ? error.code
                  : "INTERNAL_ERROR",
            },
            {
              status:
                typeof error === "object" &&
                error !== null &&
                "status" in error &&
                typeof error.status === "number"
                  ? error.status
                  : 500,
            },
          )
        : formErrorResponse(request, redirectTo, error),
      idempotencyKey ? `${idempotencyKey}:0` : null,
      error,
    );
  }
}
