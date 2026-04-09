import { authService } from "@/server/auth/service";
import { getAdminHealthSummary } from "@/server/health";

import { getAdminStorageSummary } from "./storage";
import { getAdminUpdateStatus } from "./updates";
import type { AdminOverviewSummary } from "./types";

export const getAdminOverviewSummary = async (
  actorUserId: string,
): Promise<AdminOverviewSummary> => {
  const [health, storage, updates, users, invites] = await Promise.all([
    getAdminHealthSummary(),
    getAdminStorageSummary(),
    getAdminUpdateStatus(),
    authService.listUsers(actorUserId),
    authService.listInvites(actorUserId),
  ]);

  const owners = users.filter((user) => user.role === "owner").length;
  const members = users.length - owners;
  const activeInvites = invites.filter(
    (invite) => invite.status === "active",
  ).length;

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
        health.queue.dead,
    },
    users: {
      total: users.length,
      owners,
      members,
      activeInvites,
    },
    updates,
  };
};
