import { randomUUID } from "node:crypto";
import { access, mkdir, open, rm } from "node:fs/promises";
import path from "node:path";

import {
  getPostgresPool,
  getPrisma,
  getUploadPostgresPool,
  Prisma,
  type PostgresPoolClient,
} from "@staaash/db/client";

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
  UPLOAD_SESSION_STATUS_COMMITTING,
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

const markResumableStagingReleased = async (id: string, now = new Date()) => {
  await getPrisma().uploadSession.updateMany({
    where: { id, stagingReleasedAt: null },
    data: {
      stagingReleasedAt: now,
      cleanupLastAttemptAt: now,
      cleanupLastError: null,
    },
  });
};

const cleanupResumableSessionStaging = async ({
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

const activateResumableSession = async ({
  id,
  ownerUserId,
  now,
}: {
  id: string;
  ownerUserId: string;
  now: Date;
}) => {
  const db = getPrisma();
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
};

const recoverFailedResumableAllocation = async ({
  id,
  ownerUserId,
  tmpPath,
}: {
  id: string;
  ownerUserId: string;
  tmpPath: string;
}) => {
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
};

const toStagingAllocationError = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  return new UploadAdmissionError(
    ["EDQUOT", "ENOSPC"].includes(code)
      ? "UPLOAD_STORAGE_CAPACITY_EXCEEDED"
      : "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE",
  );
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
    return await activateResumableSession({ id, ownerUserId, now });
  } catch (error) {
    await recoverFailedResumableAllocation({ id, ownerUserId, tmpPath });
    if (allocatingFilesystem) throw toStagingAllocationError(error);
    throw error;
  }
};

export const findActiveResumableSession = async (
  id: string,
  ownerUserId: string,
  includeCompletedChunks = true,
  now = new Date(),
): Promise<ResumableSession | null> => {
  const row = await getPrisma().uploadSession.findFirst({
    where: {
      id,
      ownerUserId,
      status: { in: [...RECEIVABLE_UPLOAD_SESSION_STATUSES] },
      expiresAt: { gt: now },
    },
    include: includeCompletedChunks
      ? { chunks: { orderBy: { chunkIndex: "asc" } } }
      : undefined,
  });
  return row ? toSession(row) : null;
};

type WriteUploadChunkInput = CompletedUploadChunk & {
  sessionId: string;
  ownerUserId: string;
  writeBytes: (signal: AbortSignal) => Promise<number>;
};

const chunkRangeMatches = (
  existing: { startByte: string; endByte: string; sizeBytes: string },
  input: CompletedUploadChunk,
) =>
  BigInt(existing.startByte) === BigInt(input.startByte) &&
  BigInt(existing.endByte) === BigInt(input.endByte) &&
  BigInt(existing.sizeBytes) === BigInt(input.sizeBytes);

const findReceivableChunkSession = async (
  client: PostgresPoolClient,
  input: WriteUploadChunkInput,
  now: Date,
) => {
  const result = await client.query<{ receivedBytes: string }>(
    `SELECT "receivedBytes"
     FROM "UploadSession"
     WHERE "id" = $1
       AND "ownerUserId" = $2
       AND "status" = ANY($3::text[])
       AND "expiresAt" > $4`,
    [
      input.sessionId,
      input.ownerUserId,
      RECEIVABLE_UPLOAD_SESSION_STATUSES,
      now,
    ],
  );
  if (!result.rows[0]) throw new Error("UPLOAD_SESSION_NOT_RECEIVABLE");
  return result.rows[0];
};

const findRecordedUploadChunk = async (
  client: PostgresPoolClient,
  input: WriteUploadChunkInput,
) => {
  const result = await client.query<{
    startByte: string;
    endByte: string;
    sizeBytes: string;
  }>(
    `SELECT "startByte", "endByte", "sizeBytes"
     FROM "UploadChunk"
     WHERE "sessionId" = $1 AND "chunkIndex" = $2`,
    [input.sessionId, input.chunkIndex],
  );
  return result.rows[0] ?? null;
};

type UploadChunkConnectionState = {
  sessionLocked: boolean;
  chunkLocked: boolean;
  destroyClient: boolean;
};

const acquireUploadChunkLocks = async (
  client: PostgresPoolClient,
  state: UploadChunkConnectionState,
  sessionLock: string,
  chunkLock: string,
) => {
  await client.query("SET lock_timeout = '15s'");
  await client.query(
    "SELECT pg_advisory_lock_shared(hashtextextended($1, 0))",
    [sessionLock],
  );
  state.sessionLocked = true;
  await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
    chunkLock,
  ]);
  state.chunkLocked = true;
};

const releaseUploadChunkLocks = async (
  client: PostgresPoolClient,
  state: UploadChunkConnectionState,
  sessionLock: string,
  chunkLock: string,
) => {
  if (state.chunkLocked) {
    await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
      chunkLock,
    ]);
  }
  if (state.sessionLocked) {
    await client.query(
      "SELECT pg_advisory_unlock_shared(hashtextextended($1, 0))",
      [sessionLock],
    );
  }
  await client.query("RESET lock_timeout");
};

const recordWrittenUploadChunk = async (
  client: PostgresPoolClient,
  state: UploadChunkConnectionState,
  input: WriteUploadChunkInput,
  now: Date,
) => {
  await client.query("BEGIN");
  try {
    await findReceivableChunkSession(client, input, now);
    const completedAt = new Date();
    await client.query(
      `INSERT INTO "UploadChunk"
        ("id", "sessionId", "chunkIndex", "startByte", "endByte", "sizeBytes", "completedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        input.sessionId,
        input.chunkIndex,
        input.startByte,
        input.endByte,
        input.sizeBytes,
        completedAt,
      ],
    );
    const updated = await client.query<{ receivedBytes: string }>(
      `UPDATE "UploadSession"
       SET "receivedBytes" = "receivedBytes" + $1,
           "status" = $2,
           "updatedAt" = $3
       WHERE "id" = $4
         AND "ownerUserId" = $5
         AND "status" = ANY($6::text[])
         AND "expiresAt" > $7
       RETURNING "receivedBytes"`,
      [
        input.sizeBytes,
        UPLOAD_SESSION_STATUS_RECEIVING,
        completedAt,
        input.sessionId,
        input.ownerUserId,
        RECEIVABLE_UPLOAD_SESSION_STATUSES,
        now,
      ],
    );
    if (!updated.rows[0]) throw new Error("UPLOAD_SESSION_NOT_RECEIVABLE");
    await client.query("COMMIT");
    return Number(updated.rows[0].receivedBytes);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      state.destroyClient = true;
    });
    throw error;
  }
};

export const writeAndRecordUploadChunk = async (
  input: WriteUploadChunkInput,
) => {
  const now = new Date();
  const sessionLock = `upload-session:${input.sessionId}`;
  const chunkLock = `upload-chunk:${input.sessionId}:${input.chunkIndex}`;
  const client = await getUploadPostgresPool().connect();
  const lockAbort = new AbortController();
  const state: UploadChunkConnectionState = {
    sessionLocked: false,
    chunkLocked: false,
    destroyClient: false,
  };
  const abortOnClientError = (error: Error) => {
    state.destroyClient = true;
    lockAbort.abort(error);
  };
  client.on("error", abortOnClientError);

  try {
    await acquireUploadChunkLocks(client, state, sessionLock, chunkLock);

    const session = await findReceivableChunkSession(client, input, now);
    const existing = await findRecordedUploadChunk(client, input);
    if (existing) {
      if (!chunkRangeMatches(existing, input)) {
        throw new Error("CHUNK_RANGE_CONFLICT");
      }
      return Number(session.receivedBytes);
    }

    const writtenLength = await input.writeBytes(lockAbort.signal);
    if (writtenLength !== input.sizeBytes) {
      throw new Error("CHUNK_LENGTH_MISMATCH");
    }
    lockAbort.signal.throwIfAborted();
    return await recordWrittenUploadChunk(client, state, input, now);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "55P03") {
      throw new Error("UPLOAD_CHUNK_LOCK_TIMEOUT", { cause: error });
    }
    throw error;
  } finally {
    if (!state.destroyClient) {
      try {
        await releaseUploadChunkLocks(client, state, sessionLock, chunkLock);
      } catch {
        state.destroyClient = true;
      }
    }
    client.off("error", abortOnClientError);
    client.release(state.destroyClient);
  }
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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`upload-session:${id}`}, 0))`;
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

const lockCommittingSession = async ({
  tx,
  id,
  ownerUserId,
  requireUnreleasedReservation = false,
}: {
  tx: Prisma.TransactionClient;
  id: string;
  ownerUserId: string;
  requireUnreleasedReservation?: boolean;
}) => {
  await lockUploadCapacityRows(tx, ownerUserId);
  const unreleasedConditions = requireUnreleasedReservation
    ? Prisma.sql`AND "stagingReleasedAt" IS NULL AND "committedFileId" IS NULL`
    : Prisma.empty;
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "UploadSession"
    WHERE "id" = ${id}
      AND "ownerUserId" = ${ownerUserId}
      AND "status" = 'committing'
      ${unreleasedConditions}
    FOR UPDATE
  `);
  if (!rows[0]) throw new Error("UPLOAD_SESSION_NOT_COMMITTING");
};

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
    await lockCommittingSession({ tx, id, ownerUserId });

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

const resumableRecoveryErrorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : "Unknown commit recovery error.")
    .slice(0, 2_000)
    .trim();

export const recordResumableCommitRecoveryError = async ({
  id,
  ownerUserId,
  error,
  now = new Date(),
}: {
  id: string;
  ownerUserId: string;
  error: unknown;
  now?: Date;
}) =>
  getPrisma().uploadSession.updateMany({
    where: {
      id,
      ownerUserId,
      status: UPLOAD_SESSION_STATUS_COMMITTING,
      stagingReleasedAt: null,
    },
    data: {
      cleanupAttemptCount: { increment: 1 },
      cleanupLastAttemptAt: now,
      cleanupLastError: resumableRecoveryErrorMessage(error),
    },
  });

export const restoreResumableSessionAfterCommitRollback = async ({
  id,
  ownerUserId,
  error,
  now = new Date(),
}: {
  id: string;
  ownerUserId: string;
  error: unknown;
  now?: Date;
}) =>
  runUploadTransaction(async (tx) => {
    await lockCommittingSession({
      tx,
      id,
      ownerUserId,
      requireUnreleasedReservation: true,
    });

    await tx.uploadSession.update({
      where: { id },
      data: {
        status: UPLOAD_SESSION_STATUS_RECEIVING,
        expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS),
        cleanupAttemptCount: { increment: 1 },
        cleanupLastAttemptAt: now,
        cleanupLastError: resumableRecoveryErrorMessage(error),
      },
    });
  });

const transitionResumableSessionToTerminal = async ({
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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`upload-session:${id}`}, 0))`;
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
