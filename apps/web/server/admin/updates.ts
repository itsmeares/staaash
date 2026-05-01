import {
  ensureBackgroundJobScheduled,
  UPDATE_CHECK_JOB_KIND,
} from "@staaash/db/jobs";
import { readInstanceUpdateCheck } from "@staaash/db/instance";

import { getSystemSettings } from "@/server/settings";

import type { AdminUpdateStatus, JsonAdminUpdateStatus } from "./types";

export const getAdminUpdateStatus = async (): Promise<AdminUpdateStatus> => {
  const [state, settings] = await Promise.all([
    readInstanceUpdateCheck(),
    getSystemSettings(),
  ]);

  return {
    currentVersion:
      process.env.STAAASH_VERSION ?? process.env.APP_VERSION ?? "0.1.0",
    repository: settings.updateCheckRepository || null,
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
