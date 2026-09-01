import {
  ensureBackgroundJobScheduled,
  findBackgroundJobById,
  UPDATE_CHECK_JOB_KIND,
} from "@staaash/db/jobs";
import { readInstanceUpdateCheck } from "@staaash/db/instance";

import { resolveAppVersion } from "@/server/app-version";
import { deriveEffectiveUpdateStatus } from "@/server/update-derive";
import { getSystemSettings } from "@/server/settings";

import type { AdminUpdateStatus, JsonAdminUpdateStatus } from "./types";

export const getAdminUpdateStatus = async (): Promise<AdminUpdateStatus> => {
  const [state, settings] = await Promise.all([
    readInstanceUpdateCheck(),
    getSystemSettings(),
  ]);

  const currentVersion = resolveAppVersion();

  const { updateCheckStatus, updateCheckMessage, latestAvailableVersion } =
    deriveEffectiveUpdateStatus({
      currentVersion,
      persisted: {
        updateCheckStatus: state.updateCheckStatus,
        updateCheckMessage: state.updateCheckMessage,
        latestAvailableVersion: state.latestAvailableVersion,
        checkedVersion: state.checkedVersion,
      },
    });

  return {
    currentVersion,
    repository: settings.updateCheckRepository || null,
    lastUpdateCheckAt: state.lastUpdateCheckAt,
    updateCheckStatus,
    updateCheckMessage,
    latestAvailableVersion,
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

export const getAdminUpdateCheckJob = async (jobId: string) => {
  const job = await findBackgroundJobById({ jobId });
  return job?.kind === UPDATE_CHECK_JOB_KIND ? job : null;
};

export const toJsonAdminUpdateStatus = (
  status: AdminUpdateStatus,
): JsonAdminUpdateStatus => ({
  ...status,
  lastUpdateCheckAt: status.lastUpdateCheckAt?.toISOString() ?? null,
});
