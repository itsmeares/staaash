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
  const [committed, reserved] = await Promise.all([
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
  ]);
  const usage = {
    committedBytes: committed._sum.sizeBytes ?? 0n,
    reservedBytes: reserved._sum.totalSizeBytes ?? 0n,
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
