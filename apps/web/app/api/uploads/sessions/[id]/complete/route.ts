import { rm } from "node:fs/promises";

import { NextRequest } from "next/server";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, notSignedInResponse } from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import { FilesError } from "@/server/files/errors";
import { computeFileSha256 } from "@/server/uploads";
import { hasCompleteUploadChunkSet } from "@/server/uploads/chunk-protocol";
import {
  findActiveResumableSession,
  markSessionCompleted,
  markSessionCancelled,
  setSessionExpectedChecksum,
  type ResumableSession,
} from "@/server/uploads/session-service";

type RouteContext = { params: Promise<{ id: string }> };

const completeSchema = z.object({
  expectedChecksum: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i),
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
  request: NextRequest,
  uploadSession: ResumableSession,
): Promise<
  | { expectedChecksum: string | null; errorResponse?: never }
  | { expectedChecksum?: never; errorResponse: Response }
> => {
  if (uploadSession.protocolVersion < 2) {
    return { expectedChecksum: uploadSession.expectedChecksum };
  }

  const parsed = completeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return {
      errorResponse: Response.json(
        { error: "A valid expectedChecksum is required." },
        { status: 400 },
      ),
    };
  }

  const expectedChecksum = parsed.data.expectedChecksum.toLowerCase();
  await setSessionExpectedChecksum(uploadSession.id, expectedChecksum);
  return { expectedChecksum };
};

const verifyUploadedFile = async (
  uploadSession: ResumableSession,
  expectedChecksum: string | null,
): Promise<Response | null> => {
  if (!expectedChecksum) return null;

  const actualChecksum = await computeFileSha256(uploadSession.tmpPath).catch(
    () => null,
  );
  if (!actualChecksum) {
    await markSessionCancelled(uploadSession.id);
    return Response.json(
      { error: "Could not read uploaded file." },
      { status: 500 },
    );
  }
  if (actualChecksum === expectedChecksum) return null;

  await Promise.all([
    rm(uploadSession.tmpPath, { force: true }),
    markSessionCancelled(uploadSession.id),
  ]);
  return Response.json(
    { error: "Checksum mismatch.", code: "CHECKSUM_MISMATCH" },
    { status: 400 },
  );
};

const commitUploadedFile = async (
  uploadSession: ResumableSession,
  session: NonNullable<Awaited<ReturnType<typeof getRequestSession>>>,
  expectedChecksum: string | null,
): Promise<Response> => {
  try {
    const file = await filesService.commitResumableUpload({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      tmpPath: uploadSession.tmpPath,
      folderId: uploadSession.folderId,
      originalName: uploadSession.originalName,
      mimeType: uploadSession.mimeType,
      totalSizeBytes: uploadSession.totalSizeBytes,
      contentChecksum: expectedChecksum,
      conflictStrategy: uploadSession.conflictStrategy as
        "fail" | "safeRename" | "replace",
    });
    await markSessionCompleted(uploadSession.id);
    return Response.json(file, { status: 201 });
  } catch (error) {
    if (error instanceof FilesError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }
};

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session)
    return notSignedInResponse(request, `/api/uploads/sessions/${id}/complete`);

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

  const checksumResult = await resolveExpectedChecksum(request, uploadSession);
  if (checksumResult.errorResponse) return checksumResult.errorResponse;

  const verificationError = await verifyUploadedFile(
    uploadSession,
    checksumResult.expectedChecksum,
  );
  if (verificationError) return verificationError;

  return commitUploadedFile(
    uploadSession,
    session,
    checksumResult.expectedChecksum,
  );
}
