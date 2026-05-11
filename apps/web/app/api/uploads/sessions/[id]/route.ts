import { open, mkdir } from "node:fs/promises";
import path from "node:path";
import { rm } from "node:fs/promises";

import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, notSignedInResponse } from "@/server/auth/http";
import {
  findActiveResumableSession,
  markSessionCancelled,
  updateSessionProgress,
} from "@/server/uploads/session-service";

type RouteContext = { params: Promise<{ id: string }> };

const parseContentRange = (
  header: string,
  totalSizeBytes: number,
): { start: number; end: number } | null => {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (total !== totalSizeBytes) return null;
  if (start > end || end >= total) return null;
  return { start, end };
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  const session = await getRequestSession(request);
  if (!session)
    return notSignedInResponse(request, `/api/uploads/sessions/${id}`);

  const uploadSession = await findActiveResumableSession(id, session.user.id);
  if (!uploadSession) {
    return Response.json(
      { error: "Upload session not found." },
      { status: 404 },
    );
  }

  return Response.json({
    id: uploadSession.id,
    receivedBytes: uploadSession.receivedBytes,
    totalSizeBytes: uploadSession.totalSizeBytes,
    expiresAt: uploadSession.expiresAt.toISOString(),
    status: uploadSession.status,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session)
    return notSignedInResponse(request, `/api/uploads/sessions/${id}`);

  const uploadSession = await findActiveResumableSession(id, session.user.id);
  if (!uploadSession) {
    return Response.json(
      { error: "Upload session not found." },
      { status: 404 },
    );
  }

  const rangeHeader = request.headers.get("content-range");
  if (!rangeHeader) {
    return Response.json(
      { error: "Content-Range header is required." },
      { status: 400 },
    );
  }

  const range = parseContentRange(rangeHeader, uploadSession.totalSizeBytes);
  if (!range) {
    return Response.json(
      { error: "Invalid Content-Range header." },
      { status: 400 },
    );
  }

  if (range.start !== uploadSession.receivedBytes) {
    return Response.json(
      {
        error: "Out-of-sequence chunk. Upload from receivedBytes.",
        receivedBytes: uploadSession.receivedBytes,
      },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  const expectedLength = range.end - range.start + 1;
  if (buffer.length !== expectedLength) {
    return Response.json(
      { error: `Chunk length mismatch. Expected ${expectedLength} bytes.` },
      { status: 400 },
    );
  }

  await mkdir(path.dirname(uploadSession.tmpPath), { recursive: true });

  const flag = range.start === 0 ? "w" : "r+";
  const fileHandle = await open(uploadSession.tmpPath, flag);
  try {
    if (range.start > 0) {
      await fileHandle.truncate(range.start);
    }
    await fileHandle.write(buffer, 0, buffer.length, range.start);
  } finally {
    await fileHandle.close();
  }

  const newReceivedBytes = range.end + 1;
  await updateSessionProgress(id, newReceivedBytes);

  return Response.json({ receivedBytes: newReceivedBytes });
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { id } = await params;
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session)
    return notSignedInResponse(request, `/api/uploads/sessions/${id}`);

  const uploadSession = await findActiveResumableSession(id, session.user.id);
  if (!uploadSession) {
    return Response.json(
      { error: "Upload session not found." },
      { status: 404 },
    );
  }

  await Promise.all([
    rm(uploadSession.tmpPath, { force: true }),
    markSessionCancelled(id),
  ]);

  return new Response(null, { status: 204 });
}
