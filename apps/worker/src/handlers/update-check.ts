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

const closesFence = (line: string, fence: string) => {
  const marker = line.trim();
  return (
    /^ {0,3}\S/.test(line) &&
    marker.startsWith(fence) &&
    marker.replaceAll(fence.charAt(0), "") === ""
  );
};

const openingFence = (line: string) => /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];

// The app's markdown viewer prints raw HTML as text, so tags and comments go.
const stripReleaseTags = (line: string) =>
  line.replace(
    /(`+)(.*?)\1|<!--.*?-->|<\/?[a-z][a-z0-9-]*(?:\s[^>]*)?\/?>/gi,
    (match) => (match.startsWith("`") ? match : ""),
  );

const FOLD = /^\s*(?:<details[^>]*>\s*)?<summary>(.*?)<\/summary>\s*$/i;
// Folded dependency and maintenance lists are for GitHub readers, not admins.
const HIDDEN_FOLD = /^(?:📦|🧹)/u;
const ALERT = /^>\s*\[!(?:note|tip|important|warning|caution)\]\s*$/i;
const PROVENANCE_START = "<!-- staaash:release-provenance:start -->";
const PROVENANCE_END = /<!-- staaash:release-provenance:end -->/;
const DETAILS_END = /^\s*<\/details>\s*$/i;

/** A line outside code blocks, and the line that ends a block to drop. */
const cleanProseLine = (line: string): { lines: string[]; until?: RegExp } => {
  if (line.trim() === PROVENANCE_START)
    return { lines: [], until: PROVENANCE_END };
  const fold = FOLD.exec(line);
  if (fold) {
    const title = stripReleaseTags(fold[1]).trim();
    if (HIDDEN_FOLD.test(title)) return { lines: [], until: DETAILS_END };
    return { lines: title ? [`## ${title}`] : [] };
  }
  if (ALERT.test(line)) return { lines: [] };
  return { lines: [stripReleaseTags(line)] };
};

const cleanReleaseNotes = (body: string) => {
  let fence: string | undefined;
  let until: RegExp | undefined;
  return (
    body
      .replace(/\r\n/g, "\n")
      .split("\n")
      .flatMap((line) => {
        if (until) {
          if (until.test(line)) until = undefined;
          return [];
        }
        if (fence) {
          if (closesFence(line, fence)) fence = undefined;
          return [line];
        }
        fence = openingFence(line);
        if (fence) return [line];
        const cleaned = cleanProseLine(line);
        until = cleaned.until;
        return cleaned.lines;
      })
      .join("\n")
      .trim()
      // The dialog already shows the release name above the notes.
      .replace(/^# [^\n]*\n*/, "")
  );
};

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
const selectChannelReleases = (
  releases: GitHubReleaseResponse[],
  channel: "stable" | "rc",
): UpdateRelease[] =>
  releases
    // GitHub releases arrive loosely typed; each field is checked once here.
    // fallow-ignore-next-line complexity
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
          notes: cleanReleaseNotes(release.body ?? "").slice(
            0,
            MAX_NOTES_LENGTH,
          ),
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
// fallow-ignore-next-line complexity
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
