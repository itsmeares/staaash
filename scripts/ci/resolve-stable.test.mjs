import assert from "node:assert/strict";
import { test } from "node:test";
import { stableImage } from "./resolve-stable.mjs";

const image = `ghcr.io/example/drive:v2.0.0@sha256:${"a".repeat(64)}`;
const release = (changes = {}) => ({
  tag_name: "v2.0.0",
  draft: false,
  prerelease: false,
  published_at: "2026-01-01T00:00:00Z",
  body: `<!-- staaash:release-provenance:start -->\n<!-- ${JSON.stringify({ tag: "v2.0.0", imageDigest: `sha256:${"a".repeat(64)}`, immutableImage: image, ...changes })} -->`,
});

await test("upgrade source follows the published stable release and pins its digest", () => {
  assert.equal(stableImage(release(), "example/drive"), image);
});

await test("drafts, prereleases and mismatched image identities cannot become upgrade sources", () => {
  for (const invalid of [
    { ...release(), draft: true },
    { ...release(), prerelease: true },
    { ...release(), published_at: null },
    { ...release(), body: "No provenance" },
    release({ tag: "v1.0.0" }),
    release({ imageDigest: "latest" }),
    release({
      immutableImage: image.replace("example/drive", "foreign/drive"),
    }),
  ])
    assert.throws(() => stableImage(invalid, "example/drive"));
});
