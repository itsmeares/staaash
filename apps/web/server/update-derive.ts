import {
  compareSemanticVersions,
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
};

/**
 * Re-derives the effective update status from the resolved current version and
 * the persisted latest version. Stale "update-available" rows written while an
 * older build was running are downgraded to "up-to-date" when the running
 * build already equals or exceeds the latest published release.
 *
 * A persisted check recorded against a different build (a non-null
 * `checkedVersion` that normalizes to a version different from the running
 * one) is invalidated to a real `updateCheckStatus: null` — the row no longer
 * describes this build, so the web side shows "Not checked" and asks for a
 * re-run. This invalidation runs before any status passthrough, so it
 * neutralizes stale rows of every status kind, not just "update-available".
 * A `null` `checkedVersion` (never recorded, or recorded on a no-comparison
 * path) never triggers it; un-normalizable versions on either side skip it.
 *
 * Pure, synchronous, and side-effect free: it only ever downgrades
 * "update-available" to "up-to-date", neutralizes a version-mismatched row
 * to `null`, and passes every other persisted value through unchanged. It
 * never touches the database.
 */
const passthrough = (
  status: UpdateCheckStatus | null,
  persisted: PersistedUpdateCheck,
): DerivedUpdateCheck => ({
  updateCheckStatus: status,
  updateCheckMessage: persisted.updateCheckMessage,
});

const checkedVersionMismatch = (
  currentVersion: string,
  persisted: PersistedUpdateCheck,
): boolean => {
  const checkedVersion = persisted.checkedVersion;
  if (checkedVersion === null) return false;
  const normalizedChecked = normalizeSemanticVersion(checkedVersion);
  const normalizedCurrent = normalizeSemanticVersion(currentVersion);
  return (
    (normalizedChecked !== null &&
      normalizedCurrent !== null &&
      compareSemanticVersions(normalizedChecked, normalizedCurrent) !== 0) ||
    false
  );
};

export const deriveEffectiveUpdateStatus = ({
  currentVersion,
  persisted,
}: {
  currentVersion: string;
  persisted: PersistedUpdateCheck;
}): DerivedUpdateCheck => {
  const status = persisted.updateCheckStatus;

  if (checkedVersionMismatch(currentVersion, persisted)) {
    return {
      updateCheckStatus: null,
      updateCheckMessage: `Update check was run against v${persisted.checkedVersion}; re-run to refresh.`,
    };
  }

  if (status !== "update-available") {
    return passthrough(status, persisted);
  }

  const normalizedCurrent = normalizeSemanticVersion(currentVersion);
  const normalizedLatest = normalizeSemanticVersion(
    persisted.latestAvailableVersion,
  );

  if (!normalizedCurrent || !normalizedLatest) {
    return passthrough(status, persisted);
  }

  if (compareSemanticVersions(normalizedCurrent, normalizedLatest) >= 0) {
    return {
      updateCheckStatus: "up-to-date",
      updateCheckMessage: `Instance is on or ahead of the latest published release (v${normalizedLatest}).`,
    };
  }

  return passthrough(status, persisted);
};
