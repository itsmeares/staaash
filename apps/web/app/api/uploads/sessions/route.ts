import { NextRequest } from "next/server";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, notSignedInResponse } from "@/server/auth/http";
import { assertUploadSizeAllowed, UploadError } from "@/server/uploads";
import { createResumableSession } from "@/server/uploads/session-service";

const createSessionSchema = z.object({
  folderId: z.string().nullable().default(null),
  originalName: z.string().trim().min(1),
  mimeType: z.string().trim().min(1),
  totalSizeBytes: z.number().int().positive(),
  conflictStrategy: z
    .enum(["fail", "safeRename", "replace"])
    .default("safeRename"),
  expectedChecksum: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{64}$/i)
    .nullable()
    .default(null),
});

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) {
    return notSignedInResponse(request, "/api/uploads/sessions");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const {
    folderId,
    originalName,
    mimeType,
    totalSizeBytes,
    conflictStrategy,
    expectedChecksum,
  } = parsed.data;

  try {
    await assertUploadSizeAllowed(totalSizeBytes);
  } catch (error) {
    if (error instanceof UploadError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }

  const uploadSession = await createResumableSession({
    ownerUserId: session.user.id,
    folderId,
    originalName,
    mimeType,
    totalSizeBytes,
    expectedChecksum,
    conflictStrategy,
  });

  return Response.json(
    {
      id: uploadSession.id,
      receivedBytes: uploadSession.receivedBytes,
      protocolVersion: uploadSession.protocolVersion,
      chunkSizeBytes: uploadSession.chunkSizeBytes,
      completedChunks: uploadSession.completedChunks,
      expiresAt: uploadSession.expiresAt.toISOString(),
    },
    { status: 201 },
  );
}
