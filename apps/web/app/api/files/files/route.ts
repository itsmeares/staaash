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
import { libraryService } from "@/server/library/service";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { pairUploadRequestItems, parseUploadManifest } from "@/server/uploads";

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

  try {
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);
    const manifest = parseUploadManifest(
      formData.get("manifest")?.toString() ?? null,
    );
    const result = await libraryService.uploadFiles({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      folderId: formData.get("folderId")?.toString() ?? null,
      items: pairUploadRequestItems(manifest, files),
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
        },
      );
    }

    if (!wantsJson(request)) {
      const count = result.uploadedFiles.length;
      return redirectWithMessage(
        request,
        redirectTo,
        "success",
        `Uploaded ${count} file${count === 1 ? "" : "s"}.`,
      );
    }

    return NextResponse.json(result, {
      status: 201,
    });
  } catch (error) {
    return wantsJson(request)
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
      : formErrorResponse(request, redirectTo, error);
  }
}
