import { rm } from "node:fs/promises";

import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse } from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import { FilesError } from "@/server/files/errors";
import { computeFileSha256 } from "@/server/uploads";
import {
  findActiveResumableSession,
  markSessionCompleted,
  markSessionCancelled,
} from "@/server/uploads/session-service";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
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

  if (uploadSession.receivedBytes !== uploadSession.totalSizeBytes) {
    return Response.json(
      {
        error: "Upload is incomplete.",
        receivedBytes: uploadSession.receivedBytes,
        totalSizeBytes: uploadSession.totalSizeBytes,
      },
      { status: 400 },
    );
  }

  if (uploadSession.expectedChecksum) {
    const actualChecksum = await computeFileSha256(uploadSession.tmpPath).catch(
      () => null,
    );
    if (!actualChecksum) {
      await markSessionCancelled(id);
      return Response.json(
        { error: "Could not read uploaded file." },
        { status: 500 },
      );
    }
    if (actualChecksum !== uploadSession.expectedChecksum) {
      await Promise.all([
        rm(uploadSession.tmpPath, { force: true }),
        markSessionCancelled(id),
      ]);
      return Response.json(
        { error: "Checksum mismatch.", code: "CHECKSUM_MISMATCH" },
        { status: 400 },
      );
    }
  }

  let file;
  try {
    file = await filesService.commitResumableUpload({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      tmpPath: uploadSession.tmpPath,
      folderId: uploadSession.folderId,
      originalName: uploadSession.originalName,
      mimeType: uploadSession.mimeType,
      totalSizeBytes: uploadSession.totalSizeBytes,
      contentChecksum: uploadSession.expectedChecksum,
      conflictStrategy: uploadSession.conflictStrategy as
        | "fail"
        | "safeRename"
        | "replace",
    });
  } catch (error) {
    if (error instanceof FilesError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }

  await markSessionCompleted(id);

  return Response.json(file, { status: 201 });
}
