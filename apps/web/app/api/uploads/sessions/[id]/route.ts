import { createWriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { NextRequest } from "next/server";

import { getRequestSession } from "@/server/auth/guards";
import { isSameOrigin, notSignedInResponse } from "@/server/auth/http";
import {
  assertStorageProtocolReady,
  StorageProtocolNotReadyError,
} from "@/server/durable-storage-mutation";
import { getUploadChunkIndex } from "@/server/uploads/chunk-protocol";
import {
  findActiveResumableSession,
  cancelAndCleanupResumableSession,
  type ResumableSession,
  updateSessionProgress,
  writeAndRecordUploadChunk,
} from "@/server/uploads/session-service";

type RouteContext = { params: Promise<{ id: string }> };
type UploadRange = { start: number; end: number };

const storageProtocolUnavailableResponse = (error: unknown) =>
  error instanceof StorageProtocolNotReadyError
    ? Response.json(
        { error: error.message, code: error.code },
        { status: error.status },
      )
    : null;

const requireStorageProtocol = async () => {
  try {
    await assertStorageProtocolReady();
    return null;
  } catch (error) {
    const response = storageProtocolUnavailableResponse(error);
    if (response) return response;
    throw error;
  }
};

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

const exactLengthStream = (expectedLength: number) => {
  let receivedLength = 0;
  return {
    stream: new Transform({
      transform(rawChunk, _encoding, callback) {
        const chunk = Buffer.isBuffer(rawChunk)
          ? rawChunk
          : Buffer.from(rawChunk as Uint8Array);
        if (receivedLength + chunk.length > expectedLength) {
          callback(new Error("CHUNK_LENGTH_MISMATCH"));
          return;
        }
        receivedLength += chunk.length;
        callback(null, chunk);
      },
      flush(callback) {
        callback(
          receivedLength === expectedLength
            ? undefined
            : new Error("CHUNK_LENGTH_MISMATCH"),
        );
      },
    }),
    getReceivedLength: () => receivedLength,
  };
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
}) => {
  return writeAndRecordUploadChunk({
    sessionId: uploadSession.id,
    ownerUserId,
    chunkIndex,
    startByte: range.start,
    endByte: range.end,
    sizeBytes: expectedLength,
    writeBytes: async (lockSignal) => {
      await mkdir(path.dirname(uploadSession.tmpPath), { recursive: true });
      const input = request.body
        ? Readable.fromWeb(request.body as never)
        : Readable.from([]);
      const validator = exactLengthStream(expectedLength);
      const output = createWriteStream(uploadSession.tmpPath, {
        flags: "r+",
        start: range.start,
        flush: true,
      });
      await pipeline(input, validator.stream, output, {
        signal: AbortSignal.any([request.signal, lockSignal]),
      });
      return validator.getReceivedLength();
    },
  });
};

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
    await fileHandle.sync();
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

// Chunk PATCH and DELETE share session authorization and error translation.
// fallow-ignore-next-line code-duplication
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

  const [protocolResponse, uploadSession] = await Promise.all([
    requireStorageProtocol(),
    findActiveResumableSession(id, session.user.id, false),
  ]);
  if (protocolResponse) return protocolResponse;
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

  const protocolResponse = await requireStorageProtocol();
  if (protocolResponse) return protocolResponse;

  const uploadSession = await findActiveResumableSession(
    id,
    session.user.id,
    false,
  );
  if (!uploadSession) {
    return Response.json(
      { error: "Upload session not found." },
      { status: 404 },
    );
  }

  await cancelAndCleanupResumableSession({
    id,
    ownerUserId: session.user.id,
    tmpPath: uploadSession.tmpPath,
  });

  return new Response(null, { status: 204 });
}
