import { randomUUID } from "node:crypto";
import { access, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import { getPrisma } from "@staaash/db/client";
import type { Prisma } from "@staaash/db/client";

import { getTmpUploadPath } from "@/server/storage";
import {
  lockUploadCapacityRows,
  reserveResumableSession,
  runUploadTransaction,
  UploadAdmissionError,
} from "@/server/uploads/admission";
import {
  RECEIVABLE_UPLOAD_SESSION_STATUSES,
  UPLOAD_ALLOCATION_LEASE_MS,
  UPLOAD_SESSION_STATUS_CANCELLED,
  UPLOAD_SESSION_STATUS_COMPLETED,
  UPLOAD_SESSION_STATUS_CREATED,
  UPLOAD_SESSION_STATUS_FAILED,
  UPLOAD_SESSION_STATUS_RECEIVING,
  UPLOAD_SESSION_TTL_MS,
} from "@/server/uploads/session-state";

const CURRENT_UPLOAD_PROTOCOL_VERSION = 2;
const DEFAULT_RESUMABLE_CHUNK_SIZE = 10 * 1024 * 1024;

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
  terminalAt: Date | null;
  stagingReleasedAt: Date | null;
  committedFileId: string | null;
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

const pathIsAbsent = async (targetPath: string) => {
  try {
    await access(targetPath);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
};

const stagingPathIsSafe = (targetPath: string) => {
  const tmpRoot = path.dirname(getTmpUploadPath("path-check"));
  const relative = path.relative(tmpRoot, path.resolve(targetPath));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const recordCleanupFailure = async (id: string, error: unknown) => {
  const message =
    error instanceof Error ? error.message.slice(0, 2_000) : "Unknown error.";
  await getPrisma()
    .uploadSession.updateMany({
      where: { id, stagingReleasedAt: null },
      data: {
        cleanupAttemptCount: { increment: 1 },
        cleanupLastAttemptAt: new Date(),
        cleanupLastError: message,
      },
    })
    .catch(() => undefined);
};

const allocateEmptyStagingFile = async (tmpPath: string) => {
  await mkdir(path.dirname(tmpPath), { recursive: true });
  const handle = await open(tmpPath, "wx");
  await handle.close();
};

export const markResumableStagingReleased = async (
  id: string,
  now = new Date(),
) => {
  await getPrisma().uploadSession.updateMany({
    where: { id, stagingReleasedAt: null },
    data: {
      stagingReleasedAt: now,
      cleanupLastAttemptAt: now,
      cleanupLastError: null,
    },
  });
};

export const cleanupResumableSessionStaging = async ({
  id,
  tmpPath,
}: {
  id: string;
  tmpPath: string;
}) => {
  try {
    if (!stagingPathIsSafe(tmpPath)) {
      throw new Error("Session staging path is outside the temporary root.");
    }
    await rm(tmpPath, { force: true });
    if (!(await pathIsAbsent(tmpPath))) {
      throw new Error("Staging path still exists after deletion.");
    }
    await markResumableStagingReleased(id);
    return true;
  } catch (error) {
    await recordCleanupFailure(id, error);
    return false;
  }
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
  allocateStagingFile: (
    tmpPath: string,
  ) => Promise<void> = allocateEmptyStagingFile,
): Promise<ResumableSession> => {
  const db = getPrisma();
  const id = randomUUID();
  const tmpPath = getTmpUploadPath(`rs-${id}`);
  const allocationExpiresAt = new Date(
    now.getTime() + UPLOAD_ALLOCATION_LEASE_MS,
  );

  await reserveResumableSession({
    id,
    ownerUserId,
    folderId,
    originalName,
    mimeType,
    totalSizeBytes,
    expectedChecksum,
    protocolVersion,
    chunkSizeBytes,
    tmpPath,
    conflictStrategy,
    expiresAt: allocationExpiresAt,
  });

  let allocatingFilesystem = true;
  try {
    await allocateStagingFile(tmpPath);
    allocatingFilesystem = false;

    const expiresAt = new Date(now.getTime() + UPLOAD_SESSION_TTL_MS);
    const updated = await db.uploadSession.updateMany({
      where: { id, ownerUserId, status: "allocating" },
      data: { status: UPLOAD_SESSION_STATUS_CREATED, expiresAt },
    });
    if (updated.count !== 1) {
      throw new Error("Upload reservation is no longer allocatable.");
    }
    const row = await db.uploadSession.findUniqueOrThrow({ where: { id } });
    return toSession(row);
  } catch (error) {
    try {
      await transitionResumableSessionToTerminal({
        id,
        ownerUserId,
        status: UPLOAD_SESSION_STATUS_FAILED,
      });
      await cleanupResumableSessionStaging({ id, tmpPath });
    } catch {
      // Keep the database reservation and owned path for worker recovery.
    }
    if (
      allocatingFilesystem &&
      ["EDQUOT", "ENOSPC"].includes((error as NodeJS.ErrnoException).code ?? "")
    ) {
      throw new UploadAdmissionError("UPLOAD_STORAGE_CAPACITY_EXCEEDED");
    }
    if (allocatingFilesystem) {
      throw new UploadAdmissionError("UPLOAD_STORAGE_CAPACITY_UNAVAILABLE");
    }
    throw error;
  }
};

export const findActiveResumableSession = async (
  id: string,
  ownerUserId: string,
  now = new Date(),
): Promise<ResumableSession | null> => {
  const row = await getPrisma().uploadSession.findFirst({
    where: {
      id,
      ownerUserId,
      status: { in: [...RECEIVABLE_UPLOAD_SESSION_STATUSES] },
      expiresAt: { gt: now },
    },
    include: { chunks: { orderBy: { chunkIndex: "asc" } } },
  });
  return row ? toSession(row) : null;
};

export const findCompletedUploadChunk = async (
  sessionId: string,
  chunkIndex: number,
): Promise<CompletedUploadChunk | null> => {
  const row = await getPrisma().uploadChunk.findUnique({
    where: { sessionId_chunkIndex: { sessionId, chunkIndex } },
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
  const now = new Date();
  const session = await getPrisma().$transaction(async (tx) => {
    const existing = await tx.uploadChunk.findUnique({
      where: { sessionId_chunkIndex: { sessionId, chunkIndex } },
    });
    if (existing) {
      const activeSession = await tx.uploadSession.findFirst({
        where: {
          id: sessionId,
          status: { in: [...RECEIVABLE_UPLOAD_SESSION_STATUSES] },
          expiresAt: { gt: now },
        },
      });
      if (!activeSession) throw new Error("UPLOAD_SESSION_NOT_RECEIVABLE");
      return activeSession;
    }

    await tx.uploadChunk.create({
      data: {
        sessionId,
        chunkIndex,
        startByte: BigInt(startByte),
        endByte: BigInt(endByte),
        sizeBytes: BigInt(sizeBytes),
      },
    });
    const updated = await tx.uploadSession.updateMany({
      where: {
        id: sessionId,
        status: { in: [...RECEIVABLE_UPLOAD_SESSION_STATUSES] },
        expiresAt: { gt: now },
      },
      data: {
        receivedBytes: { increment: BigInt(sizeBytes) },
        status: UPLOAD_SESSION_STATUS_RECEIVING,
      },
    });
    if (updated.count !== 1) throw new Error("UPLOAD_SESSION_NOT_RECEIVABLE");
    return tx.uploadSession.findUniqueOrThrow({ where: { id: sessionId } });
  });
  return Number(session.receivedBytes);
};

export const updateSessionProgress = async (
  id: string,
  receivedBytes: number,
): Promise<void> => {
  const updated = await getPrisma().uploadSession.updateMany({
    where: {
      id,
      status: { in: [...RECEIVABLE_UPLOAD_SESSION_STATUSES] },
      expiresAt: { gt: new Date() },
    },
    data: {
      receivedBytes: BigInt(receivedBytes),
      status: UPLOAD_SESSION_STATUS_RECEIVING,
    },
  });
  if (updated.count !== 1) throw new Error("UPLOAD_SESSION_NOT_RECEIVABLE");
};

export const beginSessionCommit = async ({
  id,
  ownerUserId,
  expectedChecksum,
  now = new Date(),
}: {
  id: string;
  ownerUserId: string;
  expectedChecksum: string | null;
  now?: Date;
}) =>
  runUploadTransaction(async (tx) => {
    await lockUploadCapacityRows(tx, ownerUserId);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "UploadSession"
      WHERE "id" = ${id}
        AND "ownerUserId" = ${ownerUserId}
        AND "status" IN ('created', 'receiving')
        AND "expiresAt" > ${now}
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error("UPLOAD_SESSION_NOT_RECEIVABLE");
    await tx.uploadSession.update({
      where: { id },
      data: {
        status: "committing",
        expectedChecksum,
        expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS),
      },
    });
  });

export const completeResumableSessionWithFile = async <T>({
  id,
  ownerUserId,
  committedFileId,
  callback,
  now = new Date(),
}: {
  id: string;
  ownerUserId: string;
  committedFileId: string;
  callback: (tx: Prisma.TransactionClient) => Promise<T>;
  now?: Date;
}) =>
  runUploadTransaction(async (tx) => {
    await lockUploadCapacityRows(tx, ownerUserId);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id"
      FROM "UploadSession"
      WHERE "id" = ${id}
        AND "ownerUserId" = ${ownerUserId}
        AND "status" = 'committing'
      FOR UPDATE
    `;
    if (!rows[0]) throw new Error("UPLOAD_SESSION_NOT_COMMITTING");

    const result = await callback(tx);
    await tx.uploadChunk.deleteMany({ where: { sessionId: id } });
    await tx.uploadSession.update({
      where: { id },
      data: {
        status: UPLOAD_SESSION_STATUS_COMPLETED,
        terminalAt: now,
        stagingReleasedAt: now,
        committedFileId,
        cleanupLastError: null,
      },
    });
    return result;
  });

export const transitionResumableSessionToTerminal = async ({
  id,
  ownerUserId,
  status,
  committedFileId,
  stagingReleasedAt,
  now = new Date(),
}: {
  id: string;
  ownerUserId: string;
  status:
    | typeof UPLOAD_SESSION_STATUS_COMPLETED
    | typeof UPLOAD_SESSION_STATUS_FAILED
    | typeof UPLOAD_SESSION_STATUS_CANCELLED;
  committedFileId?: string | null;
  stagingReleasedAt?: Date | null;
  now?: Date;
}) =>
  runUploadTransaction(async (tx) => {
    await lockUploadCapacityRows(tx, ownerUserId);
    const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT "id", "status"
      FROM "UploadSession"
      WHERE "id" = ${id} AND "ownerUserId" = ${ownerUserId}
      FOR UPDATE
    `;
    const session = rows[0];
    if (!session) return false;
    if (
      ["completed", "failed", "cancelled", "expired"].includes(session.status)
    ) {
      return true;
    }
    await tx.uploadChunk.deleteMany({ where: { sessionId: id } });
    await tx.uploadSession.update({
      where: { id },
      data: {
        status,
        terminalAt: now,
        committedFileId,
        ...(stagingReleasedAt === undefined ? {} : { stagingReleasedAt }),
      },
    });
    return true;
  });

export const failAndCleanupResumableSession = async ({
  id,
  ownerUserId,
  tmpPath,
}: {
  id: string;
  ownerUserId: string;
  tmpPath: string;
}) => {
  await transitionResumableSessionToTerminal({
    id,
    ownerUserId,
    status: UPLOAD_SESSION_STATUS_FAILED,
  });
  return cleanupResumableSessionStaging({ id, tmpPath });
};

export const cancelAndCleanupResumableSession = async ({
  id,
  ownerUserId,
  tmpPath,
}: {
  id: string;
  ownerUserId: string;
  tmpPath: string;
}) => {
  await transitionResumableSessionToTerminal({
    id,
    ownerUserId,
    status: UPLOAD_SESSION_STATUS_CANCELLED,
  });
  return cleanupResumableSessionStaging({ id, tmpPath });
};
