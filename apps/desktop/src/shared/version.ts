/** Whether version `a` is newer than `b`, comparing x.y.z numerically. */
export const newer = (a: string, b: string) => {
  const parse = (value: string) =>
    value
      .split("-")[0]
      .split(".")
      .map((part) => Number(part) || 0);
  const [left, right] = [parse(a), parse(b)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
};

/**
 * Like `newer`, but a release beats its own release candidates, and later
 * candidates beat earlier ones: 2.0.0 > 2.0.0-rc.9 > 2.0.0-rc.8. `newer`
 * treats them as equal on purpose, so a candidate app still meets a
 * server's minimum version; updates must tell them apart.
 */
export const newerRelease = (a: string, b: string) => {
  if (newer(a, b)) return true;
  if (newer(b, a)) return false;
  const candidate = (value: string) => {
    const tag = value.split("-")[1];
    return tag === undefined ? Infinity : Number(/\d+$/.exec(tag)?.[0] ?? 0);
  };
  return candidate(a) > candidate(b);
};

/**
 * Whether updates include release candidates. Until the person chooses, a
 * candidate install keeps getting candidates and a stable one does not, so
 * someone who tried an RC returns to stable once the release is out.
 */
export const wantsCandidates = (choice: boolean | null, appVersion: string) =>
  choice ?? appVersion.includes("-");

/** The newest version in a GitHub release list, skipping drafts. */
export const newestRelease = (
  releases: { tag_name: string; draft: boolean; prerelease: boolean }[],
  includeCandidates: boolean,
) =>
  releases
    .filter((release) => !release.draft)
    .filter((release) => includeCandidates || !release.prerelease)
    .map((release) => release.tag_name.replace(/^v/, ""))
    .reduce<string | null>(
      (best, version) =>
        best === null || newerRelease(version, best) ? version : best,
      null,
    );

/**
 * The first server release with sync. Older servers have no /api/version,
 * which is how the app tells them apart; this is only for the message.
 */
export const FIRST_SYNC_SERVER = "2.0.0";
