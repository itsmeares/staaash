import { mkdir, statfs } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { getPrisma, Prisma } from "@staaash/db/client";

import { getStorageRoot } from "@/server/storage";
import { getTerminalBacklogLimits } from "@/server/uploads/session-state";

export type UploadAdmissionErrorCode =
  | "UPLOAD_SIZE_LIMIT_EXCEEDED"
  | "RESUMABLE_USER_SESSION_LIMIT_EXCEEDED"
  | "RESUMABLE_INSTANCE_SESSION_LIMIT_EXCEEDED"
  | "RESUMABLE_USER_RESERVED_BYTES_LIMIT_EXCEEDED"
  | "RESUMABLE_INSTANCE_RESERVED_BYTES_LIMIT_EXCEEDED"
  | "UPLOAD_USER_SESSION_BACKLOG_LIMIT_EXCEEDED"
  | "UPLOAD_INSTANCE_SESSION_BACKLOG_LIMIT_EXCEEDED"
  | "USER_STORAGE_QUOTA_EXCEEDED"
  | "UPLOAD_STORAGE_CAPACITY_EXCEEDED"
  | "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE"
  | "UPLOAD_ADMISSION_BUSY";

const admissionErrorDetails: Record<
  UploadAdmissionErrorCode,
  { status: number; message: string }
> = {
  UPLOAD_SIZE_LIMIT_EXCEEDED: {
    status: 413,
    message: "This upload exceeds the configured maximum file size.",
  },
  RESUMABLE_USER_SESSION_LIMIT_EXCEEDED: {
    status: 429,
    message: "Too many active resumable uploads for this user.",
  },
  RESUMABLE_INSTANCE_SESSION_LIMIT_EXCEEDED: {
    status: 429,
    message: "This instance has reached its active resumable-upload limit.",
  },
  RESUMABLE_USER_RESERVED_BYTES_LIMIT_EXCEEDED: {
    status: 429,
    message: "This user has reached the resumable staging limit.",
  },
  RESUMABLE_INSTANCE_RESERVED_BYTES_LIMIT_EXCEEDED: {
    status: 429,
    message: "This instance has reached its resumable staging limit.",
  },
  UPLOAD_USER_SESSION_BACKLOG_LIMIT_EXCEEDED: {
    status: 503,
    message: "This user's upload-session cleanup backlog is full.",
  },
  UPLOAD_INSTANCE_SESSION_BACKLOG_LIMIT_EXCEEDED: {
    status: 503,
    message: "The upload-session cleanup backlog is full.",
  },
  USER_STORAGE_QUOTA_EXCEEDED: {
    status: 413,
    message: "This upload would exceed the user's storage quota.",
  },
  UPLOAD_STORAGE_CAPACITY_EXCEEDED: {
    status: 507,
    message: "There is not enough safe staging capacity for this upload.",
  },
  UPLOAD_STORAGE_CAPACITY_UNAVAILABLE: {
    status: 503,
    message: "Upload storage capacity could not be verified.",
  },
  UPLOAD_ADMISSION_BUSY: {
    status: 503,
    message: "Upload admission is busy. Try again shortly.",
  },
};

export class UploadAdmissionError extends Error {
  readonly code: UploadAdmissionErrorCode;
  readonly status: number;
  readonly details?: Record<string, string | number>;

  constructor(
    code: UploadAdmissionErrorCode,
    details?: Record<string, string | number>,
  ) {
    super(admissionErrorDetails[code].message);
    this.name = "UploadAdmissionError";
    this.code = code;
    this.status = admissionErrorDetails[code].status;
    this.details = details;
  }
}

type UploadTransactionClient = Prisma.TransactionClient;

type LockedSettings = {
  id: string;
  maxUploadBytes: bigint;
  resumableMaxActiveSessionsPerUser: number;
  resumableMaxActiveSessionsInstance: number;
  resumableMaxReservedBytesPerUser: bigint;
  resumableMaxReservedBytesInstance: bigint;
};

type LockedUser = {
  id: string;
  storageLimitBytes: bigint | null;
};

type AdmissionStats = {
  userActiveCount: bigint;
  instanceActiveCount: bigint;
  userActiveReservedBytes: bigint;
  userStagingLiabilityBytes: bigint;
  instanceStagingLiabilityBytes: bigint;
  instanceOutstandingGrowthBytes: bigint;
  userTerminalCount: bigint;
  instanceTerminalCount: bigint;
  userCommittedBytes: bigint;
};

const toBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" || typeof value === "string") {
    return BigInt(value);
  }
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(value.toString());
  }
  throw new TypeError("Expected a PostgreSQL integer aggregate.");
};

const MAX_TRANSACTION_ATTEMPTS = 3;

const firstString = (...values: unknown[]) =>
  values.find((value): value is string => typeof value === "string");

const readNestedErrorCode = (value: unknown) => {
  if (!value || typeof value !== "object") return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
};

const getErrorCode = (error: unknown) => {
  if (typeof error !== "object") return null;
  if (error === null) return null;
  const candidate = error as {
    code?: unknown;
    meta?: unknown;
    cause?: unknown;
    name?: unknown;
    message?: unknown;
  };
  const directCode = firstString(
    candidate.code,
    readNestedErrorCode(candidate.meta),
    readNestedErrorCode(candidate.cause),
    candidate.name,
  );
  if (directCode) return directCode;
  if (typeof candidate.message !== "string") return null;
  return candidate.message.includes("TransactionWriteConflict")
    ? "TransactionWriteConflict"
    : null;
};

const isRetryableTransactionConflict = (error: unknown) =>
  ["P2028", "P2034", "40001", "40P01", "TransactionWriteConflict"].includes(
    getErrorCode(error) ?? "",
  );

export const runUploadTransaction = async <T>(
  callback: (tx: UploadTransactionClient) => Promise<T>,
): Promise<T> => {
  const db = getPrisma();
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 5_000,
      });
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) {
        throw error;
      }
      if (attempt === MAX_TRANSACTION_ATTEMPTS - 1) {
        throw new UploadAdmissionError("UPLOAD_ADMISSION_BUSY");
      }
      await delay(25 * 2 ** attempt + Math.floor(Math.random() * 25));
    }
  }
  throw new UploadAdmissionError("UPLOAD_ADMISSION_BUSY");
};

export const lockUploadCapacityRows = async (
  tx: UploadTransactionClient,
  ownerUserId: string,
) => {
  const settingsRows = await tx.$queryRaw<LockedSettings[]>`
    SELECT
      "id",
      "maxUploadBytes",
      "resumableMaxActiveSessionsPerUser",
      "resumableMaxActiveSessionsInstance",
      "resumableMaxReservedBytesPerUser",
      "resumableMaxReservedBytesInstance"
    FROM "SystemSettings"
    WHERE "id" = 'singleton'
    FOR UPDATE
  `;
  const settings = settingsRows[0];
  if (!settings) {
    throw new UploadAdmissionError("UPLOAD_ADMISSION_BUSY");
  }

  const userRows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "storageLimitBytes"
    FROM "User"
    WHERE "id" = ${ownerUserId}
    FOR UPDATE
  `;
  const user = userRows[0];
  if (!user) {
    throw new UploadAdmissionError("UPLOAD_ADMISSION_BUSY");
  }
  return { settings, user };
};

export const lockUserQuotaRow = async (
  tx: UploadTransactionClient,
  ownerUserId: string,
) => {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id", "storageLimitBytes"
    FROM "User"
    WHERE "id" = ${ownerUserId}
    FOR UPDATE
  `;
  const user = rows[0];
  if (!user) throw new UploadAdmissionError("UPLOAD_ADMISSION_BUSY");
  return user;
};

const readAdmissionStats = async (
  tx: UploadTransactionClient,
  ownerUserId: string,
) => {
  const rows = await tx.$queryRaw<AdmissionStats[]>`
    SELECT
      COUNT(*) FILTER (
        WHERE "ownerUserId" = ${ownerUserId}
          AND (
            ("status" IN ('allocating', 'created', 'receiving') AND "expiresAt" > CURRENT_TIMESTAMP)
            OR "status" = 'committing'
          )
      ) AS "userActiveCount",
      COUNT(*) FILTER (
        WHERE
          ("status" IN ('allocating', 'created', 'receiving') AND "expiresAt" > CURRENT_TIMESTAMP)
          OR "status" = 'committing'
      ) AS "instanceActiveCount",
      COALESCE(SUM("totalSizeBytes") FILTER (
        WHERE "ownerUserId" = ${ownerUserId}
          AND (
            ("status" IN ('allocating', 'created', 'receiving') AND "expiresAt" > CURRENT_TIMESTAMP)
            OR "status" = 'committing'
          )
      ), 0) AS "userActiveReservedBytes",
      COALESCE(SUM("totalSizeBytes") FILTER (
        WHERE "ownerUserId" = ${ownerUserId}
          AND "stagingReleasedAt" IS NULL
      ), 0) AS "userStagingLiabilityBytes",
      COALESCE(SUM("totalSizeBytes") FILTER (
        WHERE "stagingReleasedAt" IS NULL
      ), 0) AS "instanceStagingLiabilityBytes",
      COALESCE(SUM(GREATEST("totalSizeBytes" - "receivedBytes", 0)) FILTER (
        WHERE "stagingReleasedAt" IS NULL
          AND (
            ("status" IN ('allocating', 'created', 'receiving') AND "expiresAt" > CURRENT_TIMESTAMP)
            OR "status" = 'committing'
          )
      ), 0) AS "instanceOutstandingGrowthBytes",
      COUNT(*) FILTER (
        WHERE "ownerUserId" = ${ownerUserId}
          AND (
            "status" IN ('completed', 'failed', 'cancelled', 'expired')
            OR (
              "status" IN ('allocating', 'created', 'receiving', 'committing')
              AND "expiresAt" <= CURRENT_TIMESTAMP
            )
          )
      ) AS "userTerminalCount",
      COUNT(*) FILTER (
        WHERE
          "status" IN ('completed', 'failed', 'cancelled', 'expired')
          OR (
            "status" IN ('allocating', 'created', 'receiving', 'committing')
            AND "expiresAt" <= CURRENT_TIMESTAMP
          )
      ) AS "instanceTerminalCount",
      (
        SELECT COALESCE(SUM("sizeBytes"), 0)
        FROM "File"
        WHERE "ownerUserId" = ${ownerUserId}
      ) AS "userCommittedBytes"
    FROM "UploadSession"
  `;
  const row = rows[0]!;
  return {
    userActiveCount: toBigInt(row.userActiveCount),
    instanceActiveCount: toBigInt(row.instanceActiveCount),
    userActiveReservedBytes: toBigInt(row.userActiveReservedBytes),
    userStagingLiabilityBytes: toBigInt(row.userStagingLiabilityBytes),
    instanceStagingLiabilityBytes: toBigInt(row.instanceStagingLiabilityBytes),
    instanceOutstandingGrowthBytes: toBigInt(
      row.instanceOutstandingGrowthBytes,
    ),
    userTerminalCount: toBigInt(row.userTerminalCount),
    instanceTerminalCount: toBigInt(row.instanceTerminalCount),
    userCommittedBytes: toBigInt(row.userCommittedBytes),
  };
};

const assertPhysicalHeadroom = async (
  outstandingGrowthBytes: bigint,
  requestedBytes: bigint,
) => {
  let disk;
  try {
    await mkdir(getStorageRoot(), { recursive: true });
    disk = await statfs(getStorageRoot());
  } catch {
    throw new UploadAdmissionError("UPLOAD_STORAGE_CAPACITY_UNAVAILABLE");
  }
  const availableBytes = BigInt(disk.bavail) * BigInt(disk.bsize);
  const totalBytes = BigInt(disk.blocks) * BigInt(disk.bsize);
  const safetyFloorBytes = totalBytes / 10n;
  if (
    availableBytes - outstandingGrowthBytes - requestedBytes <
    safetyFloorBytes
  ) {
    throw new UploadAdmissionError("UPLOAD_STORAGE_CAPACITY_EXCEEDED");
  }
};

const assertUploadSizeAllowed = (
  settings: LockedSettings,
  requestedBytes: bigint,
) => {
  if (requestedBytes > settings.maxUploadBytes) {
    throw new UploadAdmissionError("UPLOAD_SIZE_LIMIT_EXCEEDED");
  }
};

const assertActiveSessionCapacity = (
  settings: LockedSettings,
  stats: AdmissionStats,
) => {
  if (
    stats.userActiveCount >= BigInt(settings.resumableMaxActiveSessionsPerUser)
  ) {
    throw new UploadAdmissionError("RESUMABLE_USER_SESSION_LIMIT_EXCEEDED");
  }
  if (
    stats.instanceActiveCount >=
    BigInt(settings.resumableMaxActiveSessionsInstance)
  ) {
    throw new UploadAdmissionError("RESUMABLE_INSTANCE_SESSION_LIMIT_EXCEEDED");
  }
};

const assertTerminalBacklogCapacity = (
  settings: LockedSettings,
  stats: AdmissionStats,
) => {
  const backlogLimits = getTerminalBacklogLimits({
    perUserActiveLimit: settings.resumableMaxActiveSessionsPerUser,
    instanceActiveLimit: settings.resumableMaxActiveSessionsInstance,
  });
  if (stats.userTerminalCount >= BigInt(backlogLimits.perUser)) {
    throw new UploadAdmissionError(
      "UPLOAD_USER_SESSION_BACKLOG_LIMIT_EXCEEDED",
      {
        current: Number(stats.userTerminalCount),
        limit: backlogLimits.perUser,
      },
    );
  }
  if (stats.instanceTerminalCount >= BigInt(backlogLimits.instance)) {
    throw new UploadAdmissionError(
      "UPLOAD_INSTANCE_SESSION_BACKLOG_LIMIT_EXCEEDED",
      {
        current: Number(stats.instanceTerminalCount),
        limit: backlogLimits.instance,
      },
    );
  }
};

const assertStagingCapacity = (
  settings: LockedSettings,
  stats: AdmissionStats,
  requestedBytes: bigint,
) => {
  if (
    stats.userStagingLiabilityBytes + requestedBytes >
    settings.resumableMaxReservedBytesPerUser
  ) {
    throw new UploadAdmissionError(
      "RESUMABLE_USER_RESERVED_BYTES_LIMIT_EXCEEDED",
    );
  }
  if (
    stats.instanceStagingLiabilityBytes + requestedBytes >
    settings.resumableMaxReservedBytesInstance
  ) {
    throw new UploadAdmissionError(
      "RESUMABLE_INSTANCE_RESERVED_BYTES_LIMIT_EXCEEDED",
    );
  }
};

const assertUserQuotaCapacity = (
  user: LockedUser,
  stats: AdmissionStats,
  requestedBytes: bigint,
) => {
  if (
    user.storageLimitBytes !== null &&
    user.storageLimitBytes > 0n &&
    stats.userCommittedBytes + stats.userActiveReservedBytes + requestedBytes >
      user.storageLimitBytes
  ) {
    throw new UploadAdmissionError("USER_STORAGE_QUOTA_EXCEEDED");
  }
};

const assertAdmissionAllowed = async ({
  settings,
  user,
  stats,
  requestedBytes,
}: {
  settings: LockedSettings;
  user: LockedUser;
  stats: AdmissionStats;
  requestedBytes: bigint;
}) => {
  assertUploadSizeAllowed(settings, requestedBytes);
  assertActiveSessionCapacity(settings, stats);
  assertTerminalBacklogCapacity(settings, stats);
  assertStagingCapacity(settings, stats, requestedBytes);
  assertUserQuotaCapacity(user, stats, requestedBytes);
  await assertPhysicalHeadroom(
    stats.instanceOutstandingGrowthBytes,
    requestedBytes,
  );
};

export const reserveResumableSession = async ({
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
  expiresAt,
}: {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  originalName: string;
  mimeType: string;
  totalSizeBytes: number;
  expectedChecksum: string | null;
  protocolVersion: number;
  chunkSizeBytes: number | null;
  tmpPath: string;
  conflictStrategy: string;
  expiresAt: Date;
}) =>
  runUploadTransaction(async (tx) => {
    const { settings, user } = await lockUploadCapacityRows(tx, ownerUserId);
    const stats = await readAdmissionStats(tx, ownerUserId);
    await assertAdmissionAllowed({
      settings,
      user,
      stats,
      requestedBytes: BigInt(totalSizeBytes),
    });
    return tx.uploadSession.create({
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
        status: "allocating",
        expiresAt,
      },
    });
  });

export const getQuotaUsageInTransaction = async (
  tx: UploadTransactionClient,
  ownerUserId: string,
) => {
  const rows = await tx.$queryRaw<
    Array<{ committedBytes: bigint; reservedBytes: bigint }>
  >`
    SELECT
      (
        SELECT COALESCE(SUM("sizeBytes"), 0)
        FROM "File"
        WHERE "ownerUserId" = ${ownerUserId}
      ) AS "committedBytes",
      COALESCE(SUM("totalSizeBytes") FILTER (
        WHERE "ownerUserId" = ${ownerUserId}
          AND (
            ("status" IN ('allocating', 'created', 'receiving') AND "expiresAt" > CURRENT_TIMESTAMP)
            OR "status" = 'committing'
          )
      ), 0) AS "reservedBytes"
    FROM "UploadSession"
  `;
  const row = rows[0]!;
  return {
    committedBytes: toBigInt(row.committedBytes),
    reservedBytes: toBigInt(row.reservedBytes),
  };
};
