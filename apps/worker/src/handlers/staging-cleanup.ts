import path from "node:path";
import { access, rm } from "node:fs/promises";

import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { getPrisma } from "@staaash/db/client";
import {
  ACTIVE_UPLOAD_SESSION_STATUSES,
  TERMINAL_UPLOAD_SESSION_STATUSES,
  UPLOAD_SESSION_STATUS_COMMITTING,
  UPLOAD_SESSION_STATUS_EXPIRED,
  UPLOAD_SESSION_STATUS_RECEIVING,
  UPLOAD_SESSION_TTL_MS,
  UPLOAD_TERMINAL_RETENTION_MS,
} from "@staaash/db/upload-sessions";

import { cleanupExpiredStagingFiles } from "../storage-maintenance.js";
import type { WorkerStoragePaths } from "../storage-maintenance.js";
import type { JobContext } from "../job-context.js";

type UploadSessionCleanupClient = {
  uploadSession: {
    findMany(args: object): Promise<
      Array<{
        id: string;
        tmpPath: string;
        ownerUserId?: string;
        status?: string;
        committedFileId?: string | null;
        conflictStrategy?: string;
      }>
    >;
    updateMany(args: object): Promise<{ count: number }>;
    deleteMany(args: object): Promise<{ count: number }>;
  };
  uploadChunk: {
    deleteMany(args: object): Promise<{ count: number }>;
  };
  $transaction<T>(
    callback: (tx: UploadSessionCleanupClient) => Promise<T>,
  ): Promise<T>;
};

const MAX_ERROR_LENGTH = 2_000;
const CLEANUP_BATCH_SIZE = 500;

const errorMessage = (error: unknown) =>
  (error instanceof Error ? error.message : "Unknown error.").slice(
    0,
    MAX_ERROR_LENGTH,
  );

const pathIsInside = (root: string, candidate: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const pathIsAbsent = async (targetPath: string) => {
  try {
    await access(targetPath);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
};

const getPathPresence = async (targetPath: string) => {
  try {
    await access(targetPath);
    return "present" as const;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "absent" as const;
    }
    throw error;
  }
};

const recordSessionCleanupFailure = async ({
  client,
  sessionId,
  error,
  now,
}: {
  client: UploadSessionCleanupClient;
  sessionId: string;
  error: unknown;
  now: Date;
}) => {
  await client.uploadSession.updateMany({
    where: { id: sessionId },
    data: {
      cleanupAttemptCount: { increment: 1 },
      cleanupLastAttemptAt: now,
      cleanupLastError: errorMessage(error),
    },
  });
};

const expireStaleSessions = async ({
  client,
  now,
}: {
  client: UploadSessionCleanupClient;
  now: Date;
}) => {
  const expirableStatuses = [...ACTIVE_UPLOAD_SESSION_STATUSES];
  const sessions = await client.uploadSession.findMany({
    where: {
      status: { in: expirableStatuses },
      expiresAt: { lte: now },
    },
    select: { id: true, tmpPath: true },
    take: CLEANUP_BATCH_SIZE,
  });

  for (const session of sessions) {
    await client.$transaction(async (tx) => {
      const result = await tx.uploadSession.updateMany({
        where: {
          id: session.id,
          status: { in: expirableStatuses },
          expiresAt: { lte: now },
        },
        data: {
          status: UPLOAD_SESSION_STATUS_EXPIRED,
          terminalAt: now,
        },
      });
      if (result.count > 0) {
        await tx.uploadChunk.deleteMany({ where: { sessionId: session.id } });
      }
    });
  }
};

const recoverStaleCommittingSessions = async ({
  client,
  tmpRoot,
  now,
}: {
  client: UploadSessionCleanupClient;
  tmpRoot: string;
  now: Date;
}) => {
  const sessions = await client.uploadSession.findMany({
    where: {
      status: UPLOAD_SESSION_STATUS_COMMITTING,
      expiresAt: { lte: now },
      stagingReleasedAt: null,
      committedFileId: null,
    },
    select: {
      id: true,
      tmpPath: true,
      committedFileId: true,
      conflictStrategy: true,
    },
    take: CLEANUP_BATCH_SIZE,
  });
  const warnings: string[] = [];

  for (const session of sessions) {
    let message: string;
    try {
      if (session.conflictStrategy === "replace") {
        throw new Error(
          "Commit outcome ambiguous: replacement storage state requires reconciliation.",
        );
      }
      if (!pathIsInside(tmpRoot, session.tmpPath)) {
        throw new Error("Session staging path is outside the temporary root.");
      }
      const presence = await getPathPresence(session.tmpPath);
      if (presence === "absent") {
        throw new Error(
          "Commit outcome ambiguous: original staging path is missing.",
        );
      }

      message =
        "Recovered stale committing session: original staging file is present.";
      const result = await client.uploadSession.updateMany({
        where: {
          id: session.id,
          status: UPLOAD_SESSION_STATUS_COMMITTING,
          expiresAt: { lte: now },
          stagingReleasedAt: null,
          committedFileId: null,
        },
        data: {
          status: UPLOAD_SESSION_STATUS_RECEIVING,
          expiresAt: new Date(now.getTime() + UPLOAD_SESSION_TTL_MS),
          cleanupAttemptCount: { increment: 1 },
          cleanupLastAttemptAt: now,
          cleanupLastError: message,
        },
      });
      if (result.count > 0) warnings.push(`${session.id}: ${message}`);
    } catch (error) {
      message = errorMessage(error);
      warnings.push(`${session.id}: ${message}`);
      await recordSessionCleanupFailure({
        client,
        sessionId: session.id,
        error,
        now,
      }).catch(() => undefined);
    }
  }

  return warnings;
};

const deleteTerminalChunks = async (client: UploadSessionCleanupClient) => {
  await client.uploadChunk.deleteMany({
    where: {
      session: { status: { in: [...TERMINAL_UPLOAD_SESSION_STATUSES] } },
    },
  });
};

const releaseTerminalStaging = async ({
  client,
  tmpRoot,
  now,
  removeStagingPath,
}: {
  client: UploadSessionCleanupClient;
  tmpRoot: string;
  now: Date;
  removeStagingPath: (targetPath: string) => Promise<void>;
}) => {
  const warnings: string[] = [];
  const sessions = await client.uploadSession.findMany({
    where: {
      status: { in: [...TERMINAL_UPLOAD_SESSION_STATUSES] },
      stagingReleasedAt: null,
    },
    select: { id: true, tmpPath: true },
    orderBy: [{ cleanupLastAttemptAt: "asc" }, { terminalAt: "asc" }],
    take: CLEANUP_BATCH_SIZE,
  });

  for (const session of sessions) {
    try {
      if (!pathIsInside(tmpRoot, session.tmpPath)) {
        throw new Error("Session staging path is outside the temporary root.");
      }
      await removeStagingPath(session.tmpPath);
      if (!(await pathIsAbsent(session.tmpPath))) {
        throw new Error("Staging path still exists after deletion.");
      }
      await client.uploadSession.updateMany({
        where: { id: session.id, stagingReleasedAt: null },
        data: {
          stagingReleasedAt: now,
          cleanupAttemptCount: { increment: 1 },
          cleanupLastAttemptAt: now,
          cleanupLastError: null,
        },
      });
    } catch (error) {
      warnings.push(`${session.id}: ${errorMessage(error)}`);
      await recordSessionCleanupFailure({
        client,
        sessionId: session.id,
        error,
        now,
      }).catch(() => undefined);
    }
  }
  return warnings;
};

const deleteRetainedTerminalSessions = async ({
  client,
  now,
  deleteTerminalRows,
}: {
  client: UploadSessionCleanupClient;
  now: Date;
  deleteTerminalRows: (sessionIds: string[]) => Promise<unknown>;
}) => {
  const cutoff = new Date(now.getTime() - UPLOAD_TERMINAL_RETENTION_MS);
  const sessions = await client.uploadSession.findMany({
    where: {
      status: { in: [...TERMINAL_UPLOAD_SESSION_STATUSES] },
      stagingReleasedAt: { not: null },
      terminalAt: { lte: cutoff },
    },
    select: { id: true, tmpPath: true },
    orderBy: { terminalAt: "asc" },
    take: CLEANUP_BATCH_SIZE,
  });
  if (sessions.length === 0) return [];

  try {
    await deleteTerminalRows(sessions.map((session) => session.id));
    return [];
  } catch (error) {
    const message = errorMessage(error);
    await client.uploadSession
      .updateMany({
        where: { id: { in: sessions.map((session) => session.id) } },
        data: {
          cleanupAttemptCount: { increment: 1 },
          cleanupLastAttemptAt: now,
          cleanupLastError: message,
        },
      })
      .catch(() => undefined);
    return [`terminal rows: ${message}`];
  }
};

// fallow-ignore-next-line unused-export
export const cleanupUploadSessionLifecycle = async ({
  client,
  storagePaths,
  now = new Date(),
  removeStagingPath = (targetPath) => rm(targetPath, { force: true }),
  deleteTerminalRows = (sessionIds) =>
    client.uploadSession.deleteMany({ where: { id: { in: sessionIds } } }),
}: {
  client: UploadSessionCleanupClient;
  storagePaths: WorkerStoragePaths;
  now?: Date;
  removeStagingPath?: (targetPath: string) => Promise<void>;
  deleteTerminalRows?: (sessionIds: string[]) => Promise<unknown>;
}) => {
  const warnings: string[] = [];
  warnings.push(
    ...(await recoverStaleCommittingSessions({
      client,
      tmpRoot: storagePaths.tmpRoot,
      now,
    })),
  );
  await expireStaleSessions({ client, now });

  try {
    await deleteTerminalChunks(client);
  } catch (error) {
    warnings.push(`terminal chunks: ${errorMessage(error)}`);
  }

  warnings.push(
    ...(await releaseTerminalStaging({
      client,
      tmpRoot: storagePaths.tmpRoot,
      now,
      removeStagingPath,
    })),
  );
  warnings.push(
    ...(await deleteRetainedTerminalSessions({
      client,
      now,
      deleteTerminalRows,
    })),
  );

  const protectedSessions = await client.uploadSession.findMany({
    where: { stagingReleasedAt: null },
    select: { id: true, tmpPath: true },
  });
  try {
    await cleanupExpiredStagingFiles({
      tmpRoot: storagePaths.tmpRoot,
      ttlMs: storagePaths.uploadStagingTtlMs,
      protectedPaths: protectedSessions.map((session) => session.tmpPath),
      now,
    });
  } catch (error) {
    warnings.push(`orphan staging: ${errorMessage(error)}`);
  }

  return warnings;
};

export const handleStagingCleanup = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
  context?: JobContext,
): Promise<void> => {
  const warnings = await cleanupUploadSessionLifecycle({
    client: getPrisma() as unknown as UploadSessionCleanupClient,
    storagePaths,
  });
  if (warnings.length > 0) {
    await context?.emitEvent(
      "cleanup_warning",
      "Staging cleanup completed with retryable failures.",
      {
        failureCount: warnings.length,
        failures: warnings.slice(0, 20),
      },
    );
    await context?.updateProgress({
      cleanupFailureCount: warnings.length,
      cleanupFailures: warnings.slice(0, 20),
    });
    console.warn(
      "[worker] Staging cleanup completed with retryable failures.",
      {
        jobId: job.id,
        failureCount: warnings.length,
        failures: warnings.slice(0, 20),
      },
    );
  }
};
