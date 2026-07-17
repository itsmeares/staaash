import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { writeInstanceUpdateCheck } from "@staaash/db/instance";
import {
  compareSemanticVersions,
  isPrereleaseVersion,
  normalizeSemanticVersion,
} from "@staaash/config/version";

import { resolveWorkerVersion } from "../runtime-version.js";

type GitHubReleaseResponse = {
  tag_name?: string;
  name?: string;
  draft?: boolean;
  prerelease?: boolean;
};

const GITHUB_API_ROOT = "https://api.github.com";

const buildGitHubHeaders = () => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "staaash-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const token = process.env.UPDATE_CHECK_TOKEN?.trim();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
};

const selectLatestCompatibleRelease = (
  releases: GitHubReleaseResponse[],
  currentVersion: string,
) => {
  const includePrereleases = isPrereleaseVersion(currentVersion);
  const compatibleVersions = releases.flatMap((release) => {
    if (release.draft) return [];

    const version = normalizeSemanticVersion(release.tag_name ?? release.name);
    if (!version) return [];

    if (
      !includePrereleases &&
      (release.prerelease === true || isPrereleaseVersion(version))
    ) {
      return [];
    }

    return [version];
  });

  compatibleVersions.sort((left, right) =>
    compareSemanticVersions(right, left),
  );

  return compatibleVersions[0] ?? null;
};

const readLatestGitHubRelease = async (
  repository: string,
  currentVersion: string,
) => {
  const response = await fetch(
    `${GITHUB_API_ROOT}/repos/${repository}/releases?per_page=100`,
    {
      headers: buildGitHubHeaders(),
    },
  );

  if (response.status === 404) {
    return {
      status: "unavailable" as const,
      latestVersion: null,
      message: `No published GitHub release found for ${repository}.`,
    };
  }

  if (!response.ok) {
    throw new Error(`GitHub release lookup failed with ${response.status}.`);
  }

  const payload = (await response.json()) as GitHubReleaseResponse[];
  const latestVersion = selectLatestCompatibleRelease(payload, currentVersion);

  if (!latestVersion) {
    return {
      status: "unavailable" as const,
      latestVersion: null,
      message: `No compatible published GitHub release found for ${repository}.`,
    };
  }

  return {
    status: "available" as const,
    latestVersion,
  };
};

/**
 * Update-check handler.
 *
 * The worker compares the configured app version to the latest GitHub release
 * so the owner admin surface can show current version state without performing
 * request-time upstream fetches.
 */
export const handleUpdateCheck = async (
  _job: BackgroundJobRecord,
): Promise<void> => {
  if (process.env.NODE_ENV !== "production") return;

  const { getPrisma } = await import("@staaash/db/client");
  const db = getPrisma();
  const settings = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });
  const repository = settings?.updateCheckRepository?.trim();
  const currentVersion = resolveWorkerVersion();

  if (!repository) {
    await writeInstanceUpdateCheck({
      lastUpdateCheckAt: new Date(),
      updateCheckStatus: "unavailable",
      updateCheckMessage: "Update checks are not configured.",
      latestAvailableVersion: null,
    });
    return;
  }

  try {
    const release = await readLatestGitHubRelease(repository, currentVersion);

    if (release.status === "unavailable") {
      await writeInstanceUpdateCheck({
        lastUpdateCheckAt: new Date(),
        updateCheckStatus: "unavailable",
        updateCheckMessage: release.message,
        latestAvailableVersion: null,
      });
      return;
    }

    const comparison = compareSemanticVersions(
      currentVersion,
      release.latestVersion,
    );
    const updateCheckStatus =
      comparison < 0 ? "update-available" : "up-to-date";
    const updateCheckMessage =
      comparison < 0
        ? `Update available: ${release.latestVersion}.`
        : `Instance is on the latest published release (${release.latestVersion}).`;

    await writeInstanceUpdateCheck({
      lastUpdateCheckAt: new Date(),
      updateCheckStatus,
      updateCheckMessage,
      latestAvailableVersion: release.latestVersion,
    });
  } catch (error) {
    await writeInstanceUpdateCheck({
      lastUpdateCheckAt: new Date(),
      updateCheckStatus: "error",
      updateCheckMessage:
        error instanceof Error ? error.message : "Update check failed.",
      latestAvailableVersion: null,
    });
  }
};
