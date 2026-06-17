import { authService } from "@/server/auth/service";
import { getAdminHealthSummary } from "@/server/health";

import { getAdminStorageSummary } from "./storage";
import { getAdminUpdateStatus } from "./updates";
import type { AdminOverviewSummary } from "./types";

export const getAdminOverviewSummary = async (
  actorUserId: string,
): Promise<AdminOverviewSummary> => {
  const [health, storage, updates, users] = await Promise.all([
    getAdminHealthSummary(),
    getAdminStorageSummary(),
    getAdminUpdateStatus(),
    authService.listUsers(actorUserId),
  ]);

  const owners = users.filter((user) => user.isOwner).length;
  const admins = users.filter((user) => user.isAdmin && !user.isOwner).length;
  const members = users.length - owners - admins;

  return {
    health,
    storage: {
      totalUsers: storage.totalUsers,
      retainedFileCount: storage.retainedFileCount,
      retainedFolderCount: storage.retainedFolderCount,
      retainedBytes: storage.retainedBytes,
    },
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
    },
    updates,
  };
};
