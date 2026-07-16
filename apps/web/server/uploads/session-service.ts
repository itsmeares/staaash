import { randomUUID } from "node:crypto";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import { getPrisma } from "@staaash/db/client";
import { getTmpUploadPath } from "@/server/storage";

const SESSION_STATUS_CREATED = "created";
const SESSION_STATUS_RECEIVING = "receiving";
const SESSION_STATUS_COMPLETED = "completed";
const SESSION_STATUS_FAILED = "failed";
const SESSION_STATUS_CANCELLED = "cancelled";

const ACTIVE_STATUSES = [SESSION_STATUS_CREATED, SESSION_STATUS_RECEIVING];

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const CURRENT_UPLOAD_PROTOCOL_VERSION = 2;
export const DEFAULT_RESUMABLE_CHUNK_SIZE = 10 * 1024 * 1024;

export type CompletedUploadChunk = {
  chunkIndex: number;
  startByte: number;
  endByte: number;
  sizeBytes: number;
};

export type ResumableSession = {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  totalSizeBytes: number;
  receivedBytes: number;
  expectedChecksum: string | null;
  protocolVersion: number;
  chunkSizeBytes: number | null;
  tmpPath: string;
  conflictStrategy: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  completedChunks: CompletedUploadChunk[];
};

const toSession = (row: {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  totalSizeBytes: bigint;
  receivedBytes: bigint;
  expectedChecksum: string | null;
  protocolVersion: number;
  chunkSizeBytes: bigint | null;
  tmpPath: string;
  conflictStrategy: string;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  chunks?: Array<{
    chunkIndex: number;
    startByte: bigint;
    endByte: bigint;
    sizeBytes: bigint;
  }>;
}): ResumableSession => {
  const { chunks = [], ...session } = row;
  return {
    ...session,
    totalSizeBytes: Number(session.totalSizeBytes),
    receivedBytes: Number(session.receivedBytes),
    chunkSizeBytes:
      session.chunkSizeBytes === null ? null : Number(session.chunkSizeBytes),
    completedChunks: chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      startByte: Number(chunk.startByte),
      endByte: Number(chunk.endByte),
      sizeBytes: Number(chunk.sizeBytes),
    })),
  };
};

export const createResumableSession = async (
  {
    ownerUserId,
    folderId,
    originalName,
    mimeType,
    totalSizeBytes,
    expectedChecksum,
    conflictStrategy,
    protocolVersion = CURRENT_UPLOAD_PROTOCOL_VERSION,
    chunkSizeBytes = DEFAULT_RESUMABLE_CHUNK_SIZE,
  }: {
    ownerUserId: string;
    folderId: string | null;
    originalName: string;
    mimeType: string;
    totalSizeBytes: number;
    expectedChecksum: string | null;
    conflictStrategy: string;
    protocolVersion?: number;
    chunkSizeBytes?: number | null;
  },
  now = new Date(),
): Promise<ResumableSession> => {
  const db = getPrisma();
  const id = randomUUID();
  const tmpPath = getTmpUploadPath(`rs-${id}`);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await mkdir(path.dirname(tmpPath), { recursive: true });
  const handle = await open(tmpPath, "wx");
  try {
    await handle.truncate(totalSizeBytes);
  } finally {
    await handle.close();
  }

  try {
    const row = await db.uploadSession.create({
      data: {
        id,
        ownerUserId,
        folderId,
        originalName,
        mimeType,
        totalSizeBytes: BigInt(totalSizeBytes),
        expectedChecksum,
        protocolVersion,
        chunkSizeBytes: chunkSizeBytes === null ? null : BigInt(chunkSizeBytes),
        tmpPath,
        conflictStrategy,
        status: SESSION_STATUS_CREATED,
        expiresAt,
      },
    });
    return toSession(row);
  } catch (error) {
    await rm(tmpPath, { force: true });
    throw error;
  }
};

export const findActiveResumableSession = async (
  id: string,
  ownerUserId: string,
  now = new Date(),
): Promise<ResumableSession | null> => {
  const db = getPrisma();
  const row = await db.uploadSession.findFirst({
    where: {
      id,
      ownerUserId,
      status: { in: ACTIVE_STATUSES },
      expiresAt: { gt: now },
    },
    include: {
      chunks: {
        orderBy: { chunkIndex: "asc" },
      },
    },
  });
  return row ? toSession(row) : null;
};

export const findCompletedUploadChunk = async (
  sessionId: string,
  chunkIndex: number,
): Promise<CompletedUploadChunk | null> => {
  const row = await getPrisma().uploadChunk.findUnique({
    where: {
      sessionId_chunkIndex: {
        sessionId,
        chunkIndex,
      },
    },
  });
  return row
    ? {
        chunkIndex: row.chunkIndex,
        startByte: Number(row.startByte),
        endByte: Number(row.endByte),
        sizeBytes: Number(row.sizeBytes),
      }
    : null;
};

export const recordCompletedUploadChunk = async ({
  sessionId,
  chunkIndex,
  startByte,
  endByte,
  sizeBytes,
}: CompletedUploadChunk & { sessionId: string }): Promise<number> => {
  const db = getPrisma();
  const session = await db.$transaction(async (transaction) => {
    const existing = await transaction.uploadChunk.findUnique({
      where: {
        sessionId_chunkIndex: {
          sessionId,
          chunkIndex,
        },
      },
    });
    if (existing) {
      return transaction.uploadSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
    }

    await transaction.uploadChunk.create({
      data: {
        sessionId,
        chunkIndex,
        startByte: BigInt(startByte),
        endByte: BigInt(endByte),
        sizeBytes: BigInt(sizeBytes),
      },
    });
    return transaction.uploadSession.update({
      where: { id: sessionId },
      data: {
        receivedBytes: { increment: BigInt(sizeBytes) },
        status: SESSION_STATUS_RECEIVING,
      },
    });
  });
  return Number(session.receivedBytes);
};

export const updateSessionProgress = async (
  id: string,
  receivedBytes: number,
): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: {
      receivedBytes: BigInt(receivedBytes),
      status: SESSION_STATUS_RECEIVING,
    },
  });
};

export const setSessionExpectedChecksum = async (
  id: string,
  expectedChecksum: string,
): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: { expectedChecksum },
  });
};

export const markSessionCompleted = async (id: string): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: { status: SESSION_STATUS_COMPLETED },
  });
};

export const markSessionCancelled = async (id: string): Promise<void> => {
  await getPrisma().uploadSession.update({
    where: { id },
    data: { status: SESSION_STATUS_CANCELLED },
  });
};
