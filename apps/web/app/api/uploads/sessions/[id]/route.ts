import { open, mkdir, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, notSignedInResponse } from "@/server/auth/http";
import { withStorageLocks } from "@/server/storage-mutations";
import { getUploadChunkIndex } from "@/server/uploads/chunk-protocol";
import {
  findCompletedUploadChunk,
  findActiveResumableSession,
  markSessionCancelled,
  recordCompletedUploadChunk,
  type ResumableSession,
  updateSessionProgress,
} from "@/server/uploads/session-service";

type RouteContext = { params: Promise<{ id: string }> };
type UploadRange = { start: number; end: number };

const parseContentRange = (
  header: string,
  totalSizeBytes: number,
): UploadRange | null => {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (total !== totalSizeBytes) return null;
  if (start > end || end >= total) return null;
  return { start, end };
};

const writeRequestBodyAtOffset = async ({
  request,
  fileHandle,
  startByte,
  expectedLength,
}: {
  request: NextRequest;
  fileHandle: FileHandle;
  startByte: number;
  expectedLength: number;
}) => {
  if (!request.body) return 0;

  let receivedLength = 0;
  const input = Readable.fromWeb(request.body as never);
  for await (const rawChunk of input) {
    const chunk = Buffer.isBuffer(rawChunk)
      ? rawChunk
      : Buffer.from(rawChunk as Uint8Array);
    if (receivedLength + chunk.length > expectedLength) {
      throw new Error("CHUNK_LENGTH_MISMATCH");
    }

    let chunkOffset = 0;
    while (chunkOffset < chunk.length) {
      const { bytesWritten } = await fileHandle.write(
        chunk,
        chunkOffset,
        chunk.length - chunkOffset,
        startByte + receivedLength + chunkOffset,
      );
      chunkOffset += bytesWritten;
    }
    receivedLength += chunk.length;
  }
  return receivedLength;
};

const validateContentLength = (
  request: NextRequest,
  expectedLength: number,
): Response | null => {
  const header = request.headers.get("content-length");
  if (header === null) return null;

  const contentLength = Number(header);
  if (!Number.isFinite(contentLength) || contentLength === expectedLength) {
    return null;
  }
  return Response.json(
    { error: `Chunk length mismatch. Expected ${expectedLength} bytes.` },
    { status: 400 },
  );
};

const writeParallelUploadChunk = async ({
  request,
  uploadSession,
  ownerUserId,
  range,
  chunkIndex,
  expectedLength,
}: {
  request: NextRequest;
  uploadSession: ResumableSession;
  ownerUserId: string;
  range: UploadRange;
  chunkIndex: number;
  expectedLength: number;
}) =>
  withStorageLocks({
    lockKeys: [`upload-chunk:${uploadSession.id}:${chunkIndex}`],
    deadline: Date.now() + 5 * 60_000,
    callback: async () => {
      const completed = await findCompletedUploadChunk(
        uploadSession.id,
        chunkIndex,
      );
      if (completed) {
        const completedRangeMatches = [
          completed.startByte === range.start,
          completed.endByte === range.end,
          completed.sizeBytes === expectedLength,
        ].every(Boolean);
        if (!completedRangeMatches) throw new Error("CHUNK_RANGE_CONFLICT");

        const current = await findActiveResumableSession(
          uploadSession.id,
          ownerUserId,
        );
        return current?.receivedBytes ?? uploadSession.receivedBytes;
      }

      await mkdir(path.dirname(uploadSession.tmpPath), { recursive: true });
      const fileHandle = await open(uploadSession.tmpPath, "r+");
      let writtenLength = 0;
      try {
        writtenLength = await writeRequestBodyAtOffset({
          request,
          fileHandle,
          startByte: range.start,
          expectedLength,
        });
      } finally {
        await fileHandle.close();
      }
      if (writtenLength !== expectedLength) {
        throw new Error("CHUNK_LENGTH_MISMATCH");
      }

      return recordCompletedUploadChunk({
        sessionId: uploadSession.id,
        chunkIndex,
        startByte: range.start,
        endByte: range.end,
        sizeBytes: expectedLength,
      });
    },
  });

const chunkConflictResponse = (
  error: unknown,
  expectedLength: number,
): Response | null => {
  if (!(error instanceof Error)) return null;
  if (error.message === "CHUNK_RANGE_CONFLICT") {
    return Response.json(
      { error: "Chunk index conflicts with an existing completed range." },
      { status: 400 },
    );
  }
  if (error.message === "CHUNK_LENGTH_MISMATCH") {
    return Response.json(
      { error: `Chunk length mismatch. Expected ${expectedLength} bytes.` },
      { status: 400 },
    );
  }
  return null;
};

const handleParallelChunkUpload = async ({
  request,
  uploadSession,
  ownerUserId,
  range,
}: {
  request: NextRequest;
  uploadSession: ResumableSession;
  ownerUserId: string;
  range: UploadRange;
}): Promise<Response> => {
  const chunkIndex = getUploadChunkIndex({
    range,
    totalSizeBytes: uploadSession.totalSizeBytes,
    chunkSizeBytes: uploadSession.chunkSizeBytes!,
  });
  if (chunkIndex === null) {
    return Response.json(
      { error: "Chunk range is not aligned to the negotiated chunk size." },
      { status: 400 },
    );
  }

  const expectedLength = range.end - range.start + 1;
  const invalidLengthResponse = validateContentLength(request, expectedLength);
  if (invalidLengthResponse) return invalidLengthResponse;

  try {
    const receivedBytes = await writeParallelUploadChunk({
      request,
      uploadSession,
      ownerUserId,
      range,
      chunkIndex,
      expectedLength,
    });
    return Response.json({ receivedBytes, chunkIndex });
  } catch (error) {
    const response = chunkConflictResponse(error, expectedLength);
    if (response) return response;
    throw error;
  }
};

const handleLegacyChunkUpload = async ({
  request,
  uploadSession,
  range,
}: {
  request: NextRequest;
  uploadSession: ResumableSession;
  range: UploadRange;
}): Promise<Response> => {
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
  const fileHandle = await open(
    uploadSession.tmpPath,
    range.start === 0 ? "w" : "r+",
  );
  try {
    if (range.start > 0) await fileHandle.truncate(range.start);
    await fileHandle.write(buffer, 0, buffer.length, range.start);
  } finally {
    await fileHandle.close();
  }

  const newReceivedBytes = range.end + 1;
  await updateSessionProgress(uploadSession.id, newReceivedBytes);
  return Response.json({ receivedBytes: newReceivedBytes });
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
    protocolVersion: uploadSession.protocolVersion,
    chunkSizeBytes: uploadSession.chunkSizeBytes,
    completedChunks: uploadSession.completedChunks,
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

  if (
    uploadSession.protocolVersion >= 2 &&
    uploadSession.chunkSizeBytes !== null
  ) {
    return handleParallelChunkUpload({
      request,
      uploadSession,
      ownerUserId: session.user.id,
      range,
    });
  }

  return handleLegacyChunkUpload({ request, uploadSession, range });
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
