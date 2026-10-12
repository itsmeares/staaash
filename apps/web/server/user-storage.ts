import { statfs } from "node:fs/promises";

import { getPrisma, type Prisma } from "@staaash/db/client";

import { FilesError } from "@/server/files/errors";
import {
  getQuotaUsageInTransaction,
  lockUserQuotaRow,
  runUploadTransaction,
} from "@/server/uploads/admission";

export type UserStorageUsage = {
  committedBytes: bigint;
  reservedBytes: bigint;
  usedBytes: bigint;
};

export const getUserStorageUsed = async (
  userId: string,
): Promise<UserStorageUsage> => {
  const client = getPrisma();
  const [committed, reserved, mutationReserved] = await Promise.all([
    client.file.aggregate({
      where: { ownerUserId: userId },
      _sum: { sizeBytes: true },
    }),
    client.uploadSession.aggregate({
      where: {
        ownerUserId: userId,
        OR: [
          {
            status: { in: ["allocating", "created", "receiving"] },
            expiresAt: { gt: new Date() },
          },
          { status: "committing" },
        ],
      },
      _sum: { totalSizeBytes: true },
    }),
    client.storageMutation.aggregate({
      where: { ownerUserId: userId, reservedBytes: { not: null } },
      _sum: { reservedBytes: true },
    }),
  ]);
  const usage = {
    committedBytes: committed._sum.sizeBytes ?? 0n,
    reservedBytes:
      (reserved._sum.totalSizeBytes ?? 0n) +
      (mutationReserved._sum.reservedBytes ?? 0n),
  };
  return {
    ...usage,
    usedBytes: usage.committedBytes + usage.reservedBytes,
  };
};

export const assertUserStorageQuotaAvailable = async (
  userId: string,
  additionalBytes: bigint,
) => {
  const client = getPrisma();
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { storageLimitBytes: true },
  });

  if (!user?.storageLimitBytes || user.storageLimitBytes <= 0n) return;

  const { usedBytes } = await getUserStorageUsed(userId);
  if (usedBytes + additionalBytes > user.storageLimitBytes) {
    throw new FilesError("USER_STORAGE_QUOTA_EXCEEDED");
  }
};

export const withUserQuotaWrite = async <T>({
  ownerUserId,
  additionalBytes,
  callback,
}: {
  ownerUserId: string;
  additionalBytes: bigint;
  callback: (tx: Prisma.TransactionClient) => Promise<T>;
}) =>
  runUploadTransaction(async (tx) => {
    const user = await lockUserQuotaRow(tx, ownerUserId);
    if (user.storageLimitBytes !== null && user.storageLimitBytes > 0n) {
      const usage = await getQuotaUsageInTransaction(tx, ownerUserId);
      if (
        usage.committedBytes + usage.reservedBytes + additionalBytes >
        user.storageLimitBytes
      ) {
        throw new FilesError("USER_STORAGE_QUOTA_EXCEEDED");
      }
    }
    return callback(tx);
  });

// fallow-ignore-next-line unused-export
export const getInstanceStorageUsed = async (): Promise<bigint> => {
  const result = await getPrisma().file.aggregate({
    _sum: { sizeBytes: true },
  });
  return result._sum.sizeBytes ?? 0n;
};

export type DiskInfo = {
  capacityBytes: bigint;
  usedBytes: bigint;
};

export const getInstanceDiskInfo = async (): Promise<DiskInfo | null> => {
  try {
    const s = await statfs(process.cwd());
    const capacity = BigInt(s.blocks) * BigInt(s.bsize);
    const free = BigInt(s.bfree) * BigInt(s.bsize);
    return { capacityBytes: capacity, usedBytes: capacity - free };
  } catch {
    return null;
  }
};

export type StorageBreakdown = {
  usedBytes: number;
  limitBytes: number | null;
  byKind: Record<"photos" | "videos" | "audio" | "documents" | "trash", number>;
  trashItems: number;
  activeShares: number;
  passwordShares: number;
};

/** What one person stores, split the way Settings → Storage shows it. */
export const getStorageBreakdown = async (
  userId: string,
): Promise<StorageBreakdown> => {
  const client = getPrisma();
  const now = new Date();
  const [usage, user, kinds, trash, shares, passwordShares] = await Promise.all(
    [
      getUserStorageUsed(userId),
      client.user.findUnique({
        where: { id: userId },
        select: { storageLimitBytes: true },
      }),
      client.$queryRaw<Array<{ kind: string; bytes: bigint }>>`
      SELECT CASE
          WHEN "mimeType" LIKE 'image/%' THEN 'photos'
          WHEN "mimeType" LIKE 'video/%' THEN 'videos'
          WHEN "mimeType" LIKE 'audio/%' THEN 'audio'
          ELSE 'documents'
        END AS kind,
        COALESCE(SUM("sizeBytes"), 0)::bigint AS bytes
      FROM "File"
      WHERE "ownerUserId" = ${userId} AND "deletedAt" IS NULL
      GROUP BY 1`,
      client.file.aggregate({
        where: { ownerUserId: userId, deletedAt: { not: null } },
        _sum: { sizeBytes: true },
        _count: true,
      }),
      client.shareLink.count({
        where: {
          createdByUserId: userId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      }),
      client.shareLink.count({
        where: {
          createdByUserId: userId,
          revokedAt: null,
          expiresAt: { gt: now },
          passwordHash: { not: null },
        },
      }),
    ],
  );
  const byKind = { photos: 0, videos: 0, audio: 0, documents: 0, trash: 0 };
  for (const row of kinds) {
    byKind[row.kind as keyof typeof byKind] = Number(row.bytes);
  }
  byKind.trash = Number(trash._sum.sizeBytes ?? 0n);
  return {
    usedBytes: Number(usage.usedBytes),
    limitBytes:
      user?.storageLimitBytes && user.storageLimitBytes > 0n
        ? Number(user.storageLimitBytes)
        : null,
    byKind,
    trashItems: trash._count,
    activeShares: shares,
    passwordShares,
  };
};
