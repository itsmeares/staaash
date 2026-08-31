import {
  compareSemanticVersions,
  normalizeSemanticVersion,
} from "@staaash/config/version";

import type { UpdateCheckStatus } from "@staaash/db/instance";

export type PersistedUpdateCheck = {
  updateCheckStatus: UpdateCheckStatus | null;
  updateCheckMessage: string | null;
  latestAvailableVersion: string | null;
};

export type DerivedUpdateCheck = {
  updateCheckStatus: UpdateCheckStatus | null;
  updateCheckMessage: string | null;
};

/**
 * Re-derives the effective update status from the resolved current version and
 * the persisted latest version. Stale "update-available" rows written while an
 * older build was running are downgraded to "up-to-date" when the running
 * build already equals or exceeds the latest published release.
 *
 * Pure, synchronous, and side-effect free: it only ever downgrades
 * "update-available" to "up-to-date" and passes every other persisted value
 * through unchanged. It never touches the database.
 */
export const deriveEffectiveUpdateStatus = ({
  currentVersion,
  persisted,
}: {
  currentVersion: string;
  persisted: PersistedUpdateCheck;
}): DerivedUpdateCheck => {
  const status = persisted.updateCheckStatus;

  if (status !== "update-available") {
    return {
      updateCheckStatus: status,
      updateCheckMessage: persisted.updateCheckMessage,
    };
  }

  const normalizedCurrent = normalizeSemanticVersion(currentVersion);
  const normalizedLatest = normalizeSemanticVersion(
    persisted.latestAvailableVersion,
  );

  if (!normalizedCurrent || !normalizedLatest) {
    return {
      updateCheckStatus: status,
      updateCheckMessage: persisted.updateCheckMessage,
    };
  }

  if (compareSemanticVersions(normalizedCurrent, normalizedLatest) >= 0) {
    return {
      updateCheckStatus: "up-to-date",
      updateCheckMessage: `Instance is on or ahead of the latest published release (v${normalizedLatest}).`,
    };
  }

  return {
    updateCheckStatus: status,
    updateCheckMessage: persisted.updateCheckMessage,
  };
};
