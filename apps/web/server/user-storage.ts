import { statfs } from "fs/promises";

import { getPrisma } from "@staaash/db/client";

import { FilesError } from "@/server/files/errors";

export type UserStorageUsage = {
  usedBytes: bigint;
};

export const getUserStorageUsed = async (
  userId: string,
): Promise<UserStorageUsage> => {
  const client = getPrisma();
  const result = await client.file.aggregate({
    where: { ownerUserId: userId },
    _sum: { sizeBytes: true },
  });

  return {
    usedBytes: result._sum.sizeBytes ?? 0n,
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

  if (!user?.storageLimitBytes) {
    return;
  }

  const { usedBytes } = await getUserStorageUsed(userId);

  if (usedBytes + additionalBytes > user.storageLimitBytes) {
    throw new FilesError("USER_STORAGE_QUOTA_EXCEEDED");
  }
};

// fallow-ignore-next-line unused-export
export const getInstanceStorageUsed = async (): Promise<bigint> => {
  const client = getPrisma();
  const result = await client.file.aggregate({
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
