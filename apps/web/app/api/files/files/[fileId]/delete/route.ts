// File mutation routes intentionally share one HTTP mutation contract.
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
import {
  attachStorageMutationHeader,
  readStorageIdempotencyKey,
} from "@/server/storage-idempotency";

type RouteContext = {
  params: Promise<{
    fileId: string;
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
          "/trash",
          new Error("Cross-origin requests are not allowed."),
        );
  }

  let redirectTo = "/trash";
  let session: Awaited<ReturnType<typeof getRequestSession>> = null;
  let idempotencyKey: string | null = null;
  try {
    const body = await readRequestBody(request);
    redirectTo = getSafeRedirectTarget(body.redirectTo, "/trash");
    session = await getRequestSession(request);

    if (!session) {
      return notSignedInResponse(request, redirectTo);
    }

    idempotencyKey = readStorageIdempotencyKey(request);
    const { fileId } = await params;
    const result = await filesService.deleteFile({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      fileId,
      idempotencyKey,
    });

    return attachStorageMutationHeader(
      wantsJson(request)
        ? NextResponse.json(result)
        : redirectWithMessage(
            request,
            redirectTo,
            "success",
            "Permanently deleted file.",
          ),
      idempotencyKey,
      session.user.id,
    );
  } catch (error) {
    const response = wantsJson(request)
      ? jsonErrorResponse(error)
      : formErrorResponse(request, redirectTo, error);
    return session
      ? attachStorageMutationHeader(
          response,
          idempotencyKey ?? request.headers.get("Idempotency-Key"),
          session.user.id,
          error,
        )
      : response;
  }
}
