import { StorageMutationConflictError } from "@staaash/db/storage-mutations";
import { StorageAdmissionBusyError } from "@staaash/db/storage-transactions";
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
  findCompletedResumableSession,
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

/** Nothing was committed: put the session back so the device can retry. */
const retryLaterResponse = async (
  uploadSession: ResumableSession,
  error: StorageMutationConflictError | StorageAdmissionBusyError,
): Promise<Response> => {
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

const storageMutationConflictResponse = async (
  uploadSession: ResumableSession,
  error: StorageMutationConflictError,
): Promise<Response> =>
  error.code === "STORAGE_MUTATION_IN_PROGRESS"
    ? retryLaterResponse(uploadSession, error)
    : Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );

const commitResumableUpload = (
  uploadSession: ResumableSession,
  session: Session,
  expectedChecksum: string | null,
  ifRevision: number | undefined,
) =>
  filesService.commitResumableUpload({
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

const commitUploadedFile = async (
  uploadSession: ResumableSession,
  session: Session,
  expectedChecksum: string | null,
  ifRevision: number | undefined,
): Promise<Response> => {
  try {
    const file = await commitResumableUpload(
      uploadSession,
      session,
      expectedChecksum,
      ifRevision,
    );
    return Response.json(file, { status: 201 });
  } catch (error) {
    return commitErrorResponse(uploadSession, error);
  }
};

/** Each commit failure says whether anything was committed. */
const commitErrorResponse = async (
  uploadSession: ResumableSession,
  error: unknown,
): Promise<Response> => {
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
  // Admission refused before any journal entry existed.
  if (error instanceof StorageAdmissionBusyError) {
    return retryLaterResponse(uploadSession, error);
  }
  return ambiguousCommitResponse(uploadSession, error);
};

/** A lost reply: the upload already finished, so answer with its file. */
const replayCompletedUpload = async ({
  body,
  session,
  id,
}: {
  body: unknown;
  session: Session;
  id: string;
}): Promise<Response> => {
  const completed = await findCompletedResumableSession(id, session.user.id);
  if (!completed) {
    return Response.json(
      { error: "Upload session not found." },
      { status: 404 },
    );
  }
  const checksum = await resolveExpectedChecksum(body, completed);
  if (checksum.errorResponse) return checksum.errorResponse;
  if (checksum.expectedChecksum !== completed.expectedChecksum) {
    return Response.json(
      { error: "Checksum mismatch.", code: "CHECKSUM_MISMATCH" },
      { status: 400 },
    );
  }
  // The journal's succeeded mutation answers without committing again.
  const file = await commitResumableUpload(
    completed,
    session,
    checksum.expectedChecksum,
    undefined,
  );
  return attachResumableMutationHeader(
    Response.json(file, { status: 201 }),
    id,
    session.user.id,
  );
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
  if (!uploadSession) return replayCompletedUpload({ body, session, id });

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
