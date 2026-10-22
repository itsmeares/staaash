import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function stableImage(release, repository) {
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  assert(!release.draft && !release.prerelease && release.published_at);
  assert.match(release.tag_name, /^v\d+\.\d+\.\d+$/);
  const match = release.body.match(
    /<!-- staaash:release-provenance:start -->\s*<!-- (\{[^]*?\}) -->/,
  );
  assert(match, "Stable release is missing immutable image provenance.");
  const provenance = JSON.parse(match[1]);
  assert.equal(provenance.tag, release.tag_name);
  assert.match(provenance.imageDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(
    provenance.immutableImage,
    `ghcr.io/${repository}:${release.tag_name}@${provenance.imageDigest}`,
  );
  return provenance.immutableImage;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repository = process.env.GITHUB_REPOSITORY ?? "itsmeares/staaash";
  assert.match(repository, /^[\w.-]+\/[\w.-]+$/);
  const release = JSON.parse(
    execFileSync("gh", ["api", `repos/${repository}/releases/latest`], {
      encoding: "utf8",
    }),
  );
  const image = stableImage(release, repository);
  console.log(`Upgrade source: ${release.tag_name}, ${image}`);
  if (process.env.GITHUB_ENV)
    appendFileSync(process.env.GITHUB_ENV, `STAAASH_UPGRADE_IMAGE=${image}\n`);
}
