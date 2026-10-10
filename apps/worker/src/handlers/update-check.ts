import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  writeInstanceUpdateCheck,
  type UpdateRelease,
} from "@staaash/db/instance";
import {
  compareSemanticVersions,
  isPrereleaseVersion,
  normalizeSemanticVersion,
} from "@staaash/config/version";

import { resolveWorkerVersion } from "../runtime-version.js";

type GitHubReleaseResponse = {
  tag_name?: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  html_url?: string | null;
};

const GITHUB_API_ROOT = "https://api.github.com";
const KEPT_RELEASES = 10;
const MAX_NOTES_LENGTH = 20_000;

const buildGitHubHeaders = () => {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "staaash-update-check",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  const token = process.env.UPDATE_CHECK_TOKEN?.trim();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
};

/** Published releases on the channel, newest first. */
export const selectChannelReleases = (
  releases: GitHubReleaseResponse[],
  channel: "stable" | "rc",
): UpdateRelease[] =>
  releases
    .flatMap((release) => {
      if (release.draft) return [];
      const version = normalizeSemanticVersion(
        release.tag_name ?? release.name,
      );
      if (!version) return [];
      const isPrerelease =
        release.prerelease === true || isPrereleaseVersion(version);
      if (isPrerelease && channel === "stable") return [];
      return [
        {
          version,
          name: release.name?.trim() || null,
          notes: (release.body ?? "").slice(0, MAX_NOTES_LENGTH),
          publishedAt: release.published_at ?? null,
          url: release.html_url ?? null,
        },
      ];
    })
    .sort((left, right) => compareSemanticVersions(right.version, left.version))
    .slice(0, KEPT_RELEASES);

/**
 * Asks GitHub for releases and stores the recent ones. Whether an update is
 * available is worked out when shown, against the running version, so the
 * answer is right straight after an upgrade.
 */
export const handleUpdateCheck = async (
  _job: BackgroundJobRecord,
): Promise<void> => {
  if (process.env.NODE_ENV !== "production") return;

  const { getPrisma } = await import("@staaash/db/client");
  const settings = await getPrisma().systemSettings.findUnique({
    where: { id: "singleton" },
  });
  if (settings && !settings.updateCheckEnabled) return;

  const checkedAt = new Date();
  const repository = settings?.updateCheckRepository?.trim();
  if (!repository) {
    await writeInstanceUpdateCheck({
      checkedAt,
      error: "No release repository is set.",
    });
    return;
  }

  const channel =
    settings?.updateChannel === "rc" || settings?.updateChannel === "stable"
      ? settings.updateChannel
      : isPrereleaseVersion(resolveWorkerVersion())
        ? "rc"
        : "stable";

  try {
    const response = await fetch(
      `${GITHUB_API_ROOT}/repos/${repository}/releases?per_page=30`,
      { headers: buildGitHubHeaders() },
    );
    if (response.status === 404) {
      throw new Error(`No releases found for ${repository}.`);
    }
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}.`);
    }
    const releases = selectChannelReleases(
      (await response.json()) as GitHubReleaseResponse[],
      channel,
    );
    await writeInstanceUpdateCheck({ checkedAt, releases });
  } catch (error) {
    await writeInstanceUpdateCheck({
      checkedAt,
      error: error instanceof Error ? error.message : "The check failed.",
    });
  }
};
