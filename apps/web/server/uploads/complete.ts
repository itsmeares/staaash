import { StorageMutationConflictError } from "@staaash/db/storage-mutations";
import { z } from "zod";

import { filesService } from "@/server/files/service";
import {
  FilesError,
  ResumableCompletionError,
  RevisionConflictError,
} from "@/server/files/errors";
import { jsonError, type Session } from "@/server/http/core";
import { attachStorageMutationHeader } from "@/server/storage-idempotency";
import { computeFileSha256 } from "@/server/uploads";
import { hasCompleteUploadChunkSet } from "@/server/uploads/chunk-protocol";
import {
  beginSessionCommit,
  failAndCleanupResumableSession,
  findActiveResumableSession,
  recordResumableCommitRecoveryError,
  restoreResumableSessionAfterCommitRollback,
  type ResumableSession,
} from "@/server/uploads/session-service";

const attachResumableMutationHeader = async (
  response: Response,
  uploadSessionId: string,
  ownerUserId: string,
) =>
  attachStorageMutationHeader(
    response,
    `resumable:${uploadSessionId}:complete`,
    ownerUserId,
  );

const completeSchema = z.object({
  expectedChecksum: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i),
});

const ifRevisionSchema = z.object({
  ifRevision: z.number().int().min(0).optional(),
});

const uploadIsComplete = (uploadSession: ResumableSession) => {
  if (uploadSession.receivedBytes !== uploadSession.totalSizeBytes) {
    return false;
  }
  if (
    uploadSession.protocolVersion < 2 ||
    uploadSession.chunkSizeBytes === null
  ) {
    return true;
  }
  return hasCompleteUploadChunkSet({
    completedChunks: uploadSession.completedChunks,
    totalSizeBytes: uploadSession.totalSizeBytes,
    chunkSizeBytes: uploadSession.chunkSizeBytes,
  });
};

const resolveExpectedChecksum = async (
  body: unknown,
  uploadSession: ResumableSession,
): Promise<
  | { expectedChecksum: string | null; errorResponse?: never }
  | { expectedChecksum?: never; errorResponse: Response }
> => {
  if (uploadSession.protocolVersion < 2) {
    return { expectedChecksum: uploadSession.expectedChecksum };
  }

  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return {
      errorResponse: Response.json(
        { error: "A valid expectedChecksum is required." },
        { status: 400 },
      ),
    };
  }

  const expectedChecksum = parsed.data.expectedChecksum.toLowerCase();
  return { expectedChecksum };
};

const verifyUploadedFile = async (
  uploadSession: ResumableSession,
  expectedChecksum: string | null,
): Promise<Response | null> => {
  if (!expectedChecksum) return null;

  let actualChecksum: string;
  try {
    actualChecksum = await computeFileSha256(uploadSession.tmpPath);
  } catch (error) {
    try {
      await restoreResumableSessionAfterCommitRollback({
        id: uploadSession.id,
        ownerUserId: uploadSession.ownerUserId,
        error: new Error("Could not read staging for checksum verification.", {
          cause: error,
        }),
      });
    } catch (restoreError) {
      await recordResumableCommitRecoveryError({
        id: uploadSession.id,
        ownerUserId: uploadSession.ownerUserId,
        error: restoreError,
      }).catch(() => undefined);
      return Response.json(
        {
          error: "Upload completion requires storage reconciliation.",
          code: "RESUMABLE_COMMIT_AMBIGUOUS",
        },
        { status: 500 },
      );
    }
    return Response.json(
      {
        error: "Could not read uploaded file. Retry completion.",
        code: "UPLOAD_STAGING_READ_FAILED",
      },
      { status: 503, headers: { "retry-after": "1" } },
    );
  }
  if (actualChecksum === expectedChecksum) return null;

  await failAndCleanupResumableSession({
    id: uploadSession.id,
    ownerUserId: uploadSession.ownerUserId,
    tmpPath: uploadSession.tmpPath,
  });
  return Response.json(
    { error: "Checksum mismatch.", code: "CHECKSUM_MISMATCH" },
    { status: 400 },
  );
};

const ambiguousCommitResponse = async (
  uploadSession: ResumableSession,
  error: unknown,
): Promise<Response> => {
  await recordResumableCommitRecoveryError({
    id: uploadSession.id,
    ownerUserId: uploadSession.ownerUserId,
    error,
  }).catch((recordError) => {
    console.error(
      "[uploads] Failed to record unknown resumable commit outcome.",
      recordError,
    );
  });
  console.error("[uploads] Resumable commit outcome is unknown.", error);
  return Response.json(
    {
      error: "Upload completion requires storage reconciliation.",
      code: "RESUMABLE_COMMIT_AMBIGUOUS",
    },
    { status: 500 },
  );
};

const storageMutationConflictResponse = async (
  uploadSession: ResumableSession,
  error: StorageMutationConflictError,
): Promise<Response> => {
  if (error.code !== "STORAGE_MUTATION_IN_PROGRESS") {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  try {
    await restoreResumableSessionAfterCommitRollback({
      id: uploadSession.id,
      ownerUserId: uploadSession.ownerUserId,
      error,
    });
  } catch (restoreError) {
    return ambiguousCommitResponse(uploadSession, restoreError);
  }

  return Response.json(
    { error: error.message, code: error.code },
    { status: error.status, headers: { "retry-after": "1" } },
  );
};

const commitUploadedFile = async (
  uploadSession: ResumableSession,
  session: Session,
  expectedChecksum: string | null,
  ifRevision: number | undefined,
): Promise<Response> => {
  try {
    const file = await filesService.commitResumableUpload({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      uploadSessionId: uploadSession.id,
      tmpPath: uploadSession.tmpPath,
      folderId: uploadSession.folderId,
      originalName: uploadSession.originalName,
      mimeType: uploadSession.mimeType,
      totalSizeBytes: uploadSession.totalSizeBytes,
      contentChecksum: expectedChecksum,
      conflictStrategy: uploadSession.conflictStrategy as
        | "fail"
        | "safeRename"
        | "replace",
      clientModifiedAt: uploadSession.clientModifiedAt,
      ifRevision,
    });
    return Response.json(file, { status: 201 });
  } catch (error) {
    if (error instanceof ResumableCompletionError) {
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers:
            error.code === "RESUMABLE_COMMIT_RETRYABLE"
              ? { "retry-after": "1" }
              : undefined,
        },
      );
    }
    // Nothing was committed: the name or revision was refused up front.
    if (error instanceof FilesError || error instanceof RevisionConflictError) {
      await failAndCleanupResumableSession({
        id: uploadSession.id,
        ownerUserId: uploadSession.ownerUserId,
        tmpPath: uploadSession.tmpPath,
      });
      return jsonError(error);
    }
    if (error instanceof StorageMutationConflictError) {
      return storageMutationConflictResponse(uploadSession, error);
    }
    return ambiguousCommitResponse(uploadSession, error);
  }
};

/**
 * Verifies the staged bytes and commits them through the journal. Every
 * outcome that leaves the result unclear keeps the staging file and says so.
 */
// Every outcome that leaves the result unclear keeps the staging file.
// fallow-ignore-next-line complexity
export const completeResumableUpload = async ({
  body,
  session,
  id,
}: {
  /** The parsed JSON body; protocol 1 sessions send none. */
  body: unknown;
  session: Session;
  id: string;
}): Promise<Response> => {
  const uploadSession = await findActiveResumableSession(id, session.user.id);
  if (!uploadSession) {
    return Response.json(
      { error: "Upload session not found." },
      { status: 404 },
    );
  }

  if (!uploadIsComplete(uploadSession)) {
    return Response.json(
      {
        error: "Upload is incomplete.",
        receivedBytes: uploadSession.receivedBytes,
        totalSizeBytes: uploadSession.totalSizeBytes,
      },
      { status: 400 },
    );
  }

  const checksumResult = await resolveExpectedChecksum(body, uploadSession);
  if (checksumResult.errorResponse) return checksumResult.errorResponse;

  try {
    await beginSessionCommit({
      id: uploadSession.id,
      ownerUserId: session.user.id,
      expectedChecksum: checksumResult.expectedChecksum,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "UPLOAD_SESSION_NOT_RECEIVABLE"
    ) {
      return attachResumableMutationHeader(
        Response.json(
          { error: "Upload session is no longer available." },
          { status: 409 },
        ),
        uploadSession.id,
        session.user.id,
      );
    }
    console.error("[uploads] Could not begin resumable commit.", error);
    return attachResumableMutationHeader(
      Response.json(
        {
          error: "Upload completion is temporarily unavailable.",
          code: "RESUMABLE_COMMIT_RETRYABLE",
        },
        { status: 503, headers: { "retry-after": "1" } },
      ),
      uploadSession.id,
      session.user.id,
    );
  }

  const verificationError = await verifyUploadedFile(
    uploadSession,
    checksumResult.expectedChecksum,
  );
  if (verificationError) return verificationError;

  return attachResumableMutationHeader(
    await commitUploadedFile(
      uploadSession,
      session,
      checksumResult.expectedChecksum,
      ifRevisionSchema.safeParse(body).data?.ifRevision,
    ),
    uploadSession.id,
    session.user.id,
  );
};
