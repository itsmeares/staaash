import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { writeInstanceUpdateCheck } from "@staaash/db/instance";

type GitHubReleaseResponse = {
  tag_name?: string;
  name?: string;
};

const GITHUB_API_ROOT = "https://api.github.com";

const normalizeVersion = (value: string) => value.trim().replace(/^v/i, "");

const parseVersionParts = (value: string) =>
  normalizeVersion(value)
    .split(".")
    .map((part) => Number.parseInt(part, 10));

export const compareVersions = (
  currentVersion: string,
  latestVersion: string,
) => {
  const currentParts = parseVersionParts(currentVersion);
  const latestParts = parseVersionParts(latestVersion);
  const maxLength = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;

    if (latestPart > currentPart) {
      return -1;
    }

    if (latestPart < currentPart) {
      return 1;
    }
  }

  return 0;
};

const buildGitHubHeaders = () => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "staaash-update-check",
  });
  const token = process.env.UPDATE_CHECK_TOKEN?.trim();

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
};

const readLatestGitHubRelease = async (repository: string) => {
  const response = await fetch(
    `${GITHUB_API_ROOT}/repos/${repository}/releases/latest`,
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

  const payload = (await response.json()) as GitHubReleaseResponse;
  const rawVersion = payload.tag_name ?? payload.name ?? "";

  if (!rawVersion.trim()) {
    return {
      status: "unavailable" as const,
      latestVersion: null,
      message: `GitHub release metadata for ${repository} did not include a version tag.`,
    };
  }

  return {
    status: "available" as const,
    latestVersion: normalizeVersion(rawVersion),
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
  const { getPrisma } = await import("@staaash/db/client");
  const db = getPrisma();
  const settings = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });
  const repository = settings?.updateCheckRepository?.trim();
  const currentVersion =
    process.env.STAAASH_VERSION?.trim() ??
    process.env.APP_VERSION?.trim() ??
    "0.1.0";

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
    const release = await readLatestGitHubRelease(repository);

    if (release.status === "unavailable") {
      await writeInstanceUpdateCheck({
        lastUpdateCheckAt: new Date(),
        updateCheckStatus: "unavailable",
        updateCheckMessage: release.message,
        latestAvailableVersion: null,
      });
      return;
    }

    const comparison = compareVersions(currentVersion, release.latestVersion);
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
