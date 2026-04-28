import { statfs } from "fs/promises";

import { getPrisma } from "@staaash/db/client";

export type UserStorageUsage = {
  usedBytes: bigint;
};

export const getUserStorageUsed = async (
  userId: string,
): Promise<UserStorageUsage> => {
  const client = getPrisma();
  const result = await (client.file as any).aggregate({
    where: { ownerUserId: userId },
    _sum: { sizeBytes: true },
  });

  return {
    usedBytes: (result._sum.sizeBytes as bigint | null) ?? 0n,
  };
};

export const getInstanceStorageUsed = async (): Promise<bigint> => {
  const client = getPrisma();
  const result = await (client.file as any).aggregate({
    _sum: { sizeBytes: true },
  });

  return (result._sum.sizeBytes as bigint | null) ?? 0n;
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
