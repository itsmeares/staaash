import { getPrisma } from "@staaash/db/client";

import { authService } from "@/server/auth/service";
import { getAdminHealthSummary } from "@/server/health";
import { UploadAdmissionError } from "@/server/uploads/admission";
import { getUserStorageUsed } from "@/server/user-storage";

import { getAdminStorageSummary } from "./storage";
import { getUpdateState } from "./updates";
import type { AdminOverviewSummary } from "./types";

// Uploads stop at the limit, so warn a little before it.
const NEAR_LIMIT_PERCENT = 90n;

export const getAdminOverviewSummary = async (
  actorUserId: string,
): Promise<AdminOverviewSummary> => {
  const now = new Date();
  const [health, storage, updates, users, shareLinks] = await Promise.all([
    getAdminHealthSummary(),
    getAdminStorageSummary(),
    getUpdateState(),
    authService.listUsers(actorUserId),
    getPrisma().shareLink.count({
      where: { revokedAt: null, expiresAt: { gt: now } },
    }),
  ]);

  const owners = users.filter((user) => user.isOwner).length;
  const admins = users.filter((user) => user.isAdmin && !user.isOwner).length;
  const members = users.length - owners - admins;
  const limited = users.filter((user) => user.storageLimitBytes !== null);
  // An account held for a usage audit has no usage to read; skip it, not
  // the whole page.
  const usage = await Promise.all(
    limited.map((user) =>
      getUserStorageUsed(user.id).then(
        ({ usedBytes }) => usedBytes,
        (error: unknown) => {
          if (
            error instanceof UploadAdmissionError &&
            error.code === "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE"
          )
            return null;
          throw error;
        },
      ),
    ),
  );

  return {
    health,
    storage: {
      totalUsers: storage.totalUsers,
      retainedFileCount: storage.retainedFileCount,
      retainedFolderCount: storage.retainedFolderCount,
      retainedBytes: storage.retainedBytes,
    },
    // Largest first, as the storage summary sorts them.
    space: storage.rows.map((row) => ({
      userId: row.userId,
      name: row.displayName ?? row.email,
      bytes: row.retainedBytes,
    })),
    nearLimit: limited.flatMap((user, index) => {
      const used = usage[index];
      const limit = user.storageLimitBytes!;
      return used != null &&
        limit > 0n &&
        used * 100n >= limit * NEAR_LIMIT_PERCENT
        ? [
            {
              userId: user.id,
              name: user.displayName ?? user.email,
              usedBytes: used,
              limitBytes: limit,
            },
          ]
        : [];
    }),
    shareLinks,
    jobs: {
      ...health.queue,
      total:
        health.queue.queued +
        health.queue.running +
        health.queue.failed +
        health.queue.dead +
        health.queue.cancelled,
    },
    users: {
      total: users.length,
      owners,
      admins,
      members,
      notSetUp: users.filter((user) => !user.preferences?.onboardingCompletedAt)
        .length,
    },
    updates,
  };
};
