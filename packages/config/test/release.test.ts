import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  appendReleaseProvenance,
  buildAssetChecksums,
  buildImmutableImageReference,
  buildReleaseManifest,
  buildReleaseProvenance,
  classifyImageState,
  findCanonicalReleaseVersionErrors,
  findReleaseImageIndexErrors,
  parseReleaseProvenance,
  parseReleaseTag,
  planLatestPromotion,
  planReleaseAssets,
  renderReleaseCompose,
  renderReleaseEnv,
  replaceReleaseProvenance,
  selectExactCiState,
  serializeReleaseManifest,
  serializeSha256Sums,
} from "../src/release.js";

const DIGEST_A = `sha256:${"a".repeat(64)}`;
const DIGEST_B = `sha256:${"b".repeat(64)}`;
const RELEASE_SHA = "1".repeat(40);
const TAG_OBJECT_SHA = "2".repeat(40);
const IMAGE_REPOSITORY = "ghcr.io/itsmeares/staaash";
const SOURCE_URL = "https://github.com/itsmeares/staaash";

const matchingImage = {
  digest: DIGEST_A,
  version: "v1.2.3",
  revision: RELEASE_SHA,
  source: SOURCE_URL,
  webVersion: "1.2.3",
  workerVersion: "1.2.3",
};

describe("release policy", () => {
  it.each([
    ["v1.2.3", "1.2.3", false],
    ["v1.2.3-rc.1", "1.2.3-rc.1", true],
    ["v1.2.3-beta.1", "1.2.3-beta.1", true],
    ["v1.2.3-alpha.1", "1.2.3-alpha.1", true],
  ])("parses canonical release tag %s", (tag, version, prerelease) => {
    expect(parseReleaseTag(tag)).toEqual({ tag, version, prerelease });
  });

  it.each([
    "V1.2.3",
    "v1.2",
    "v01.2.3",
    "v1.2.3-rc.01",
    "v1.2.3+build.1",
    "latest",
    " v1.2.3",
  ])("rejects noncanonical release tag %s", (tag) => {
    expect(parseReleaseTag(tag)).toBeNull();
  });

  it("requires exact versions in every package", () => {
    expect(
      findCanonicalReleaseVersionErrors({
        tag: "v1.2.3-rc.1",
        packageVersions: {
          root: "1.2.3-rc.1",
          web: "1.2.3-rc.1",
          worker: "1.2.3-rc.0",
          config: "v1.2.3-rc.1",
          db: "1.2.3-rc.1",
        },
      }),
    ).toEqual([
      "worker has 1.2.3-rc.0; expected 1.2.3-rc.1",
      "config has v1.2.3-rc.1; expected 1.2.3-rc.1",
    ]);
  });

  it("selects only newest exact main-push CI attempt", () => {
    const state = selectExactCiState({
      releaseSha: RELEASE_SHA,
      runs: [
        {
          id: 1,
          event: "pull_request",
          head_branch: "feature",
          head_sha: RELEASE_SHA,
          status: "completed",
          conclusion: "success",
        },
        {
          id: 2,
          run_attempt: 1,
          event: "push",
          head_branch: "main",
          head_sha: RELEASE_SHA,
          status: "completed",
          conclusion: "failure",
        },
        {
          id: 2,
          run_attempt: 2,
          event: "push",
          head_branch: "main",
          head_sha: RELEASE_SHA,
          status: "completed",
          conclusion: "success",
        },
      ],
    });

    expect(state.status).toBe("success");
    expect(state.status === "success" && state.run.run_attempt).toBe(2);
  });

  it("prefers a newer CI execution over an older rerun attempt", () => {
    const state = selectExactCiState({
      releaseSha: RELEASE_SHA,
      runs: [
        {
          id: 10,
          run_attempt: 2,
          event: "push",
          head_branch: "main",
          head_sha: RELEASE_SHA,
          status: "completed",
          conclusion: "success",
        },
        {
          id: 11,
          run_attempt: 1,
          event: "push",
          head_branch: "main",
          head_sha: RELEASE_SHA,
          status: "completed",
          conclusion: "failure",
        },
      ],
    });

    expect(state.status).toBe("failure");
    expect(state.status === "failure" && state.run.id).toBe(11);
  });

  it("distinguishes missing, pending, and failed exact CI", () => {
    expect(selectExactCiState({ runs: [], releaseSha: RELEASE_SHA })).toEqual({
      status: "missing",
    });

    const pendingRun = {
      id: 3,
      event: "push",
      head_branch: "main",
      head_sha: RELEASE_SHA,
      status: "in_progress",
      conclusion: null,
    };
    expect(
      selectExactCiState({ runs: [pendingRun], releaseSha: RELEASE_SHA }),
    ).toEqual({ status: "pending", run: pendingRun });

    const failedRun = {
      ...pendingRun,
      status: "completed",
      conclusion: "cancelled",
    };
    expect(
      selectExactCiState({ runs: [failedRun], releaseSha: RELEASE_SHA }),
    ).toEqual({ status: "failure", run: failedRun });
  });

  it("classifies matching and conflicting immutable images", () => {
    expect(
      classifyImageState({
        observed: matchingImage,
        expected: {
          digest: DIGEST_A,
          version: "v1.2.3",
          revision: RELEASE_SHA,
          source: SOURCE_URL,
        },
      }),
    ).toEqual({ status: "matching", image: matchingImage });

    const conflict = classifyImageState({
      observed: { ...matchingImage, digest: DIGEST_B, workerVersion: "1.2.2" },
      expected: {
        digest: DIGEST_A,
        version: "v1.2.3",
        revision: RELEASE_SHA,
        source: SOURCE_URL,
      },
    });
    expect(conflict.status).toBe("conflict");
    expect(conflict.status === "conflict" && conflict.reasons).toEqual([
      `image digest is ${DIGEST_B}; expected ${DIGEST_A}`,
      "worker runtime version is 1.2.2; expected 1.2.3",
    ]);
  });

  it("accepts only one linux/amd64 runnable image plus attestations", () => {
    const amd64 = {
      platform: { os: "linux", architecture: "amd64" },
    };
    const attestation = {
      platform: { os: "unknown", architecture: "unknown" },
      annotations: { "vnd.docker.reference.type": "attestation-manifest" },
    };

    expect(
      findReleaseImageIndexErrors({
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [amd64, attestation],
      }),
    ).toEqual([]);
    expect(
      findReleaseImageIndexErrors({
        mediaType: "application/vnd.oci.image.index.v1+json",
        manifests: [
          amd64,
          { platform: { os: "linux", architecture: "arm64" } },
        ],
      }),
    ).toEqual(["image index has 2 runnable manifests; expected 1"]);
    expect(
      findReleaseImageIndexErrors({
        mediaType: "application/vnd.oci.image.manifest.v1+json",
      }),
    ).toEqual([
      "image media type is application/vnd.oci.image.manifest.v1+json; expected OCI index",
      "image index has 0 runnable manifests; expected 1",
    ]);
  });

  it("builds tag-plus-index-digest image references", () => {
    expect(
      buildImmutableImageReference({
        imageRepository: IMAGE_REPOSITORY,
        tag: "v1.2.3-rc.1",
        digest: DIGEST_A,
      }),
    ).toBe(`${IMAGE_REPOSITORY}:v1.2.3-rc.1@${DIGEST_A}`);
  });

  it("generates exact Compose and env assets for both services", () => {
    const composeSource = [
      "services:",
      "  web:",
      "    image: ghcr.io/itsmeares/staaash:${STAAASH_VERSION:-latest}",
      "  worker:",
      "    image: ghcr.io/itsmeares/staaash:${STAAASH_VERSION:-latest}",
      "",
    ].join("\n");
    const envSource = "DB_PASSWORD=change-me\nSTAAASH_VERSION=latest\n";
    const versionReference = `v1.2.3-rc.1@${DIGEST_A}`;

    const compose = renderReleaseCompose({
      source: composeSource,
      imageRepository: "ghcr.io/scratch/staaash",
      versionReference,
    });
    const env = renderReleaseEnv({ source: envSource, versionReference });

    expect(compose.match(/v1\.2\.3-rc\.1@sha256:/gu)).toHaveLength(2);
    expect(compose).not.toContain("latest");
    expect(compose).toContain("ghcr.io/scratch/staaash:${STAAASH_VERSION:-");
    expect(env).toContain(`STAAASH_VERSION=${versionReference}`);
    expect(env).not.toContain("STAAASH_VERSION=latest");
  });

  it("renders the repository release templates before publication", async () => {
    const versionReference = `v1.2.3@${DIGEST_A}`;
    const compose = renderReleaseCompose({
      source: await readFile(
        new URL("../../../docker-compose.yml", import.meta.url),
        "utf8",
      ),
      imageRepository: IMAGE_REPOSITORY,
      versionReference,
    });
    const environment = renderReleaseEnv({
      source: await readFile(
        new URL("../../../example.env", import.meta.url),
        "utf8",
      ),
      versionReference,
    });

    expect(compose.match(/v1\.2\.3@sha256:/gu)).toHaveLength(2);
    expect(compose).not.toContain("${STAAASH_VERSION:-latest}");
    expect(environment).toContain(`STAAASH_VERSION=${versionReference}`);
  });

  it("fails closed when source asset anchors drift", () => {
    expect(() =>
      renderReleaseCompose({
        source: "services: {}\n",
        imageRepository: IMAGE_REPOSITORY,
        versionReference: `v1.2.3@${DIGEST_A}`,
      }),
    ).toThrow("Expected 2 Staaash image fallbacks");
    expect(() =>
      renderReleaseEnv({
        source: "STAAASH_VERSION=v1.2.2\n",
        versionReference: `v1.2.3@${DIGEST_A}`,
      }),
    ).toThrow("Expected 1 STAAASH_VERSION=latest entry");
  });

  it("serializes deterministic manifest and checksums", () => {
    const release = parseReleaseTag("v1.2.3")!;
    const manifest = buildReleaseManifest({
      release,
      repository: "itsmeares/staaash",
      commit: RELEASE_SHA,
      tagObject: TAG_OBJECT_SHA,
      tagType: "annotated",
      imageRepository: IMAGE_REPOSITORY,
      imageDigest: DIGEST_A,
    });
    const serialized = serializeReleaseManifest(manifest);
    const checksums = buildAssetChecksums({
      "example.env": "env\n",
      "docker-compose.yml": "compose\n",
      "release-manifest.json": serialized,
    });

    expect(manifest.image.indexDigest).toBe(DIGEST_A);
    expect(manifest.image.immutableReference).toBe(
      `${IMAGE_REPOSITORY}:v1.2.3@${DIGEST_A}`,
    );
    expect(serialized).not.toContain("runId");
    expect(Object.keys(checksums)).toEqual([
      "docker-compose.yml",
      "example.env",
      "release-manifest.json",
    ]);
    expect(serializeSha256Sums(checksums)).toMatch(
      /^[0-9a-f]{64}  docker-compose\.yml\n[0-9a-f]{64}  example\.env\n[0-9a-f]{64}  release-manifest\.json\n$/u,
    );
  });

  it("preserves notes outside managed provenance block", () => {
    const pending = buildReleaseProvenance({
      tag: "v1.2.3",
      commit: RELEASE_SHA,
      tagObject: TAG_OBJECT_SHA,
      imageDigest: "pending",
      immutableImage: "pending",
      assetChecksums: null,
    });
    const complete = buildReleaseProvenance({
      ...pending,
      imageDigest: DIGEST_A,
      immutableImage: `${IMAGE_REPOSITORY}:v1.2.3@${DIGEST_A}`,
      assetChecksums: { "example.env": DIGEST_B },
    });

    const withPending = appendReleaseProvenance({
      body: "Generated notes stay here.\n",
      provenance: pending,
    });
    const withComplete = replaceReleaseProvenance({
      body: withPending,
      expected: pending,
      next: complete,
    });

    expect(withComplete).toContain("Generated notes stay here.");
    expect(parseReleaseProvenance(withComplete)).toEqual(
      expect.objectContaining({ status: "valid", provenance: complete }),
    );
    expect(() =>
      appendReleaseProvenance({ body: withPending, provenance: pending }),
    ).toThrow("already exists or is malformed");
  });

  it("plans idempotent draft assets without clobbering", () => {
    const expected = {
      "docker-compose.yml": DIGEST_A,
      "example.env": DIGEST_B,
    };
    const observed = [
      { name: "docker-compose.yml", digest: DIGEST_A },
      { name: "extra.txt", digest: DIGEST_A },
    ];

    expect(planReleaseAssets({ expected, observed, published: false })).toEqual(
      {
        upload: ["example.env"],
        matching: ["docker-compose.yml"],
        conflicts: [],
      },
    );
    expect(planReleaseAssets({ expected, observed, published: true })).toEqual({
      upload: [],
      matching: ["docker-compose.yml"],
      conflicts: ["example.env is missing from published release"],
    });
    expect(
      planReleaseAssets({
        expected,
        observed: [{ name: "docker-compose.yml", digest: DIGEST_B }],
        published: false,
      }).conflicts,
    ).toContain(`docker-compose.yml has ${DIGEST_B}; expected ${DIGEST_A}`);
  });

  it("isolates prerelease and promotes stable latest monotonically", () => {
    expect(
      planLatestPromotion({
        candidateVersion: "1.2.3-beta.1",
        candidateDigest: DIGEST_A,
        candidateRevision: RELEASE_SHA,
        latest: null,
      }),
    ).toEqual({ action: "skip-prerelease" });

    expect(
      planLatestPromotion({
        candidateVersion: "1.2.3",
        candidateDigest: DIGEST_A,
        candidateRevision: RELEASE_SHA,
        latest: null,
      }),
    ).toEqual({ action: "promote", reason: "missing" });

    expect(
      planLatestPromotion({
        candidateVersion: "1.2.3",
        candidateDigest: DIGEST_A,
        candidateRevision: RELEASE_SHA,
        latest: {
          digest: DIGEST_A,
          version: "v1.2.3",
          revision: RELEASE_SHA,
        },
      }),
    ).toEqual({ action: "noop", reason: "matching" });

    expect(
      planLatestPromotion({
        candidateVersion: "1.2.3",
        candidateDigest: DIGEST_A,
        candidateRevision: RELEASE_SHA,
        latest: {
          digest: DIGEST_B,
          version: "v1.3.0",
          revision: "3".repeat(40),
        },
      }),
    ).toEqual({ action: "superseded", reason: "newer-version" });

    expect(
      planLatestPromotion({
        candidateVersion: "1.2.3",
        candidateDigest: DIGEST_A,
        candidateRevision: RELEASE_SHA,
        latest: {
          digest: DIGEST_B,
          version: "v1.2.3",
          revision: RELEASE_SHA,
        },
      }),
    ).toEqual({
      action: "conflict",
      reason: "latest has same version but a different digest",
    });
  });
});
