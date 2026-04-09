import {
  ensureBackgroundJobScheduled,
  UPDATE_CHECK_JOB_KIND,
} from "@staaash/db/jobs";
import { readInstanceUpdateCheck } from "@staaash/db/instance";

import { env } from "@/lib/env";

import type { AdminUpdateStatus, JsonAdminUpdateStatus } from "./types";

export const getAdminUpdateStatus = async (): Promise<AdminUpdateStatus> => {
  const state = await readInstanceUpdateCheck();

  return {
    currentVersion: env.APP_VERSION,
    repository: env.UPDATE_CHECK_REPOSITORY || null,
    lastUpdateCheckAt: state.lastUpdateCheckAt,
    updateCheckStatus: state.updateCheckStatus,
    updateCheckMessage: state.updateCheckMessage,
    latestAvailableVersion: state.latestAvailableVersion,
  };
};

export const enqueueAdminUpdateCheck = async (now = new Date()) =>
  ensureBackgroundJobScheduled({
    kind: UPDATE_CHECK_JOB_KIND,
    runAt: now,
    payloadJson: {
      source: "admin-manual-check",
    },
    windowEnd: now,
    now,
  });

export const toJsonAdminUpdateStatus = (
  status: AdminUpdateStatus,
): JsonAdminUpdateStatus => ({
  ...status,
  lastUpdateCheckAt: status.lastUpdateCheckAt?.toISOString() ?? null,
});
