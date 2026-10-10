import {
  ensureBackgroundJobScheduled,
  findBackgroundJobById,
  UPDATE_CHECK_JOB_KIND,
} from "@staaash/db/jobs";
import {
  readInstanceUpdateState,
  type InstanceUpdateState,
  type UpdateRelease,
} from "@staaash/db/instance";
import {
  compareSemanticVersions,
  isPrereleaseVersion,
  parseSemanticVersion,
} from "@staaash/config/version";

import { resolveAppVersion } from "@/server/app-version";
import { getSystemSettings } from "@/server/settings";

export type { UpdateRelease };

export type UpdateStatus =
  "update-available" | "up-to-date" | "error" | "off" | "unchecked";

export type UpdateState = {
  currentVersion: string;
  enabled: boolean;
  channel: "stable" | "rc";
  /** False while the channel follows the running version. */
  channelChosen: boolean;
  repository: string | null;
  lastCheckedAt: string | null;
  error: string | null;
  status: UpdateStatus;
  latest: UpdateRelease | null;
  /** Releases newer than the running version, newest first. */
  missed: UpdateRelease[];
  /** How big the newest missed release is, for how loudly to tell. */
  kind: "major" | "minor" | "patch" | "prerelease" | null;
};

// Partial on purpose: readiness reads this from settings that may be missing.
type UpdateSettings = {
  updateCheckEnabled?: boolean;
  updateChannel?: string | null;
  updateCheckRepository?: string;
};

const releaseKind = (from: string, to: string): UpdateState["kind"] => {
  const current = parseSemanticVersion(from);
  const next = parseSemanticVersion(to);
  if (!current || !next) return null;
  if (next.prerelease.length > 0) return "prerelease";
  if (next.major !== current.major) return "major";
  if (next.minor !== current.minor) return "minor";
  return "patch";
};

/**
 * Works out the update state when it is shown, against the running
 * version, so it is right straight after an upgrade.
 */
export const deriveUpdateState = ({
  currentVersion,
  instance,
  settings,
}: {
  currentVersion: string;
  instance: InstanceUpdateState;
  settings: UpdateSettings;
}): UpdateState => {
  const channelChosen =
    settings.updateChannel === "stable" || settings.updateChannel === "rc";
  const channel = channelChosen
    ? (settings.updateChannel as "stable" | "rc")
    : isPrereleaseVersion(currentVersion)
      ? "rc"
      : "stable";
  const releases = instance.updateReleases.filter(
    (release) => channel === "rc" || !isPrereleaseVersion(release.version),
  );
  const missed = releases.filter(
    (release) => compareSemanticVersions(release.version, currentVersion) > 0,
  );
  const enabled = settings.updateCheckEnabled !== false;
  const status: UpdateStatus = !enabled
    ? "off"
    : missed.length > 0
      ? "update-available"
      : instance.updateCheckError && releases.length === 0
        ? "error"
        : instance.lastUpdateCheckAt
          ? "up-to-date"
          : "unchecked";

  return {
    currentVersion,
    enabled,
    channel,
    channelChosen,
    repository: settings.updateCheckRepository?.trim() || null,
    lastCheckedAt: instance.lastUpdateCheckAt?.toISOString() ?? null,
    error: instance.updateCheckError,
    status,
    latest: releases[0] ?? null,
    missed,
    kind: missed[0] ? releaseKind(currentVersion, missed[0].version) : null,
  };
};

export const getUpdateState = async (): Promise<UpdateState> => {
  const [instance, settings] = await Promise.all([
    readInstanceUpdateState(),
    getSystemSettings(),
  ]);
  return deriveUpdateState({
    currentVersion: resolveAppVersion(),
    instance,
    settings,
  });
};

export const enqueueAdminUpdateCheck = async (now = new Date()) =>
  ensureBackgroundJobScheduled({
    kind: UPDATE_CHECK_JOB_KIND,
    runAt: now,
    payloadJson: { source: "admin-manual-check" },
    windowEnd: now,
    now,
  });

export const getAdminUpdateCheckJob = async (jobId: string) => {
  const job = await findBackgroundJobById({ jobId });
  return job?.kind === UPDATE_CHECK_JOB_KIND ? job : null;
};
