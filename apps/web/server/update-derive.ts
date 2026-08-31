import {
  compareSemanticVersions,
  formatVersionLabel,
  normalizeSemanticVersion,
} from "@staaash/config/version";

import type { UpdateCheckStatus } from "@staaash/db/instance";

export type PersistedUpdateCheck = {
  updateCheckStatus: UpdateCheckStatus | null;
  updateCheckMessage: string | null;
  latestAvailableVersion: string | null;
  checkedVersion: string | null;
};

export type DerivedUpdateCheck = {
  updateCheckStatus: UpdateCheckStatus | null;
  updateCheckMessage: string | null;
  latestAvailableVersion: string | null;
};

/** Invalidates persisted release data produced by another app version. */
export const deriveEffectiveUpdateStatus = ({
  currentVersion,
  persisted,
}: {
  currentVersion: string;
  persisted: PersistedUpdateCheck;
}): DerivedUpdateCheck => {
  const checkedVersion = persisted.checkedVersion;
  const normalizedChecked = normalizeSemanticVersion(checkedVersion);
  const normalizedCurrent = normalizeSemanticVersion(currentVersion);
  if (
    checkedVersion !== null &&
    (normalizedChecked === null ||
      normalizedCurrent === null ||
      compareSemanticVersions(normalizedChecked, normalizedCurrent) !== 0)
  ) {
    return {
      updateCheckStatus: null,
      updateCheckMessage: `Update check was run against ${formatVersionLabel(checkedVersion)}; re-run to refresh.`,
      latestAvailableVersion: null,
    };
  }

  return {
    updateCheckStatus: persisted.updateCheckStatus,
    updateCheckMessage: persisted.updateCheckMessage,
    latestAvailableVersion: persisted.latestAvailableVersion,
  };
};
