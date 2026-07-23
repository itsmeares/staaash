import { createHash } from "node:crypto";

import {
  compareSemanticVersions,
  isPrereleaseVersion,
  parseSemanticVersion,
} from "./version.js";

export const RELEASE_PROVENANCE_START =
  "<!-- staaash:release-provenance:start -->";
export const RELEASE_PROVENANCE_END = "<!-- staaash:release-provenance:end -->";

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const RELEASE_IMAGE_FALLBACK_PATTERN =
  /ghcr\.io\/itsmeares\/staaash:\$\{STAAASH_VERSION:-latest\}/gu;
const RELEASE_ENV_VERSION_PATTERN = /^STAAASH_VERSION=latest$/gmu;

export type ReleaseTag = {
  tag: string;
  version: string;
  prerelease: boolean;
};

export type ReleaseManifest = {
  schemaVersion: 1;
  tag: string;
  version: string;
  prerelease: boolean;
  source: {
    repository: string;
    commit: string;
    tagObject: string;
    tagType: "annotated" | "lightweight";
  };
  image: {
    repository: string;
    tag: string;
    indexDigest: string;
    immutableReference: string;
    platforms: ["linux/amd64"];
    labels: {
      version: string;
      revision: string;
      source: string;
    };
  };
};

export type ReleaseProvenance = {
  schemaVersion: 1;
  tag: string;
  commit: string;
  tagObject: string;
  imageDigest: string | "pending";
  immutableImage: string | "pending";
  assetChecksums: Record<string, string> | null;
};

export type WorkflowRun = {
  id: number;
  run_attempt?: number;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string | null;
  conclusion: string | null;
};

export type ExactCiState =
  | { status: "success"; run: WorkflowRun }
  | { status: "pending"; run: WorkflowRun }
  | { status: "failure"; run: WorkflowRun }
  | { status: "missing" };

export type ObservedImage = {
  digest: string;
  version: string | null;
  revision: string | null;
  source: string | null;
  webVersion: string | null;
  workerVersion: string | null;
};

export type ExpectedImage = {
  digest?: string;
  version: string;
  revision: string;
  source: string;
};

export type ImageState =
  | { status: "missing" }
  | { status: "matching"; image: ObservedImage }
  | { status: "conflict"; reasons: string[] };

export type ImageIndexDescriptor = {
  mediaType?: string;
  digest?: string;
  platform?: {
    os?: string;
    architecture?: string;
  };
  annotations?: Record<string, string>;
};

export type ImageIndex = {
  mediaType?: string;
  manifests?: ImageIndexDescriptor[];
};

export type ReleaseAsset = {
  name: string;
  digest: string | null;
};

export type AssetPlan = {
  upload: string[];
  matching: string[];
  conflicts: string[];
};

export type LatestImage = {
  digest: string;
  version: string | null;
  revision: string | null;
};

export type LatestPlan =
  | { action: "skip-prerelease" }
  | { action: "promote"; reason: "missing" | "older" }
  | { action: "noop"; reason: "matching" }
  | { action: "superseded"; reason: "newer-version" }
  | { action: "conflict"; reason: string };

export const hashReleaseContent = (content: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const countMatches = (value: string, pattern: RegExp) =>
  Array.from(value.matchAll(pattern)).length;

export const isSha256Digest = (value: string): boolean =>
  SHA256_PATTERN.test(value);

export const parseReleaseTag = (tag: string): ReleaseTag | null => {
  if (!tag.startsWith("v") || tag.startsWith("V") || tag.includes("+")) {
    return null;
  }

  const parsed = parseSemanticVersion(tag);
  if (!parsed || tag !== `v${parsed.normalized}`) return null;

  return {
    tag,
    version: parsed.normalized,
    prerelease: parsed.prerelease.length > 0,
  };
};

export const findCanonicalReleaseVersionErrors = ({
  tag,
  packageVersions,
}: {
  tag: string;
  packageVersions: Record<string, string>;
}): string[] => {
  const release = parseReleaseTag(tag);
  if (!release)
    return [`release tag "${tag}" is not canonical OCI-safe SemVer`];

  return Object.entries(packageVersions)
    .filter(([, packageVersion]) => packageVersion !== release.version)
    .map(
      ([packageName, packageVersion]) =>
        `${packageName} has ${packageVersion}; expected ${release.version}`,
    );
};

export const selectExactCiState = ({
  runs,
  releaseSha,
}: {
  runs: WorkflowRun[];
  releaseSha: string;
}): ExactCiState => {
  const exactRuns = runs
    .filter(
      (run) =>
        run.event === "push" &&
        run.head_branch === "main" &&
        run.head_sha === releaseSha,
    )
    .sort((left, right) => {
      const executionComparison = right.id - left.id;
      return executionComparison !== 0
        ? executionComparison
        : (right.run_attempt ?? 1) - (left.run_attempt ?? 1);
    });

  const run = exactRuns[0];
  if (!run) return { status: "missing" };
  if (run.status !== "completed") return { status: "pending", run };
  if (run.conclusion === "success") return { status: "success", run };
  return { status: "failure", run };
};

const getImageDigestReasons = (
  observed: ObservedImage,
  expected: ExpectedImage,
) => {
  const reasons: string[] = [];
  if (!isSha256Digest(observed.digest)) {
    reasons.push(`image digest is invalid: ${observed.digest}`);
  }
  if (expected.digest && observed.digest !== expected.digest) {
    reasons.push(
      `image digest is ${observed.digest}; expected ${expected.digest}`,
    );
  }
  return reasons;
};

const getImageLabelReasons = (
  observed: ObservedImage,
  expected: ExpectedImage,
) => {
  const reasons: string[] = [];
  if (observed.version !== expected.version) {
    reasons.push(
      `image version is ${observed.version ?? "missing"}; expected ${expected.version}`,
    );
  }
  if (observed.revision !== expected.revision) {
    reasons.push(
      `image revision is ${observed.revision ?? "missing"}; expected ${expected.revision}`,
    );
  }
  if (observed.source !== expected.source) {
    reasons.push(
      `image source is ${observed.source ?? "missing"}; expected ${expected.source}`,
    );
  }
  return reasons;
};

const getImageRuntimeReasons = (
  observed: ObservedImage,
  expected: ExpectedImage,
) => {
  const expectedRuntime = expected.version.replace(/^v/u, "");
  const reasons: string[] = [];
  if (observed.webVersion !== expectedRuntime) {
    reasons.push(
      `web runtime version is ${observed.webVersion ?? "missing"}; expected ${expectedRuntime}`,
    );
  }
  if (observed.workerVersion !== expectedRuntime) {
    reasons.push(
      `worker runtime version is ${observed.workerVersion ?? "missing"}; expected ${expectedRuntime}`,
    );
  }
  return reasons;
};

export const classifyImageState = ({
  observed,
  expected,
}: {
  observed: ObservedImage | null;
  expected: ExpectedImage;
}): ImageState => {
  if (!observed) return { status: "missing" };

  const reasons = [
    ...getImageDigestReasons(observed, expected),
    ...getImageLabelReasons(observed, expected),
    ...getImageRuntimeReasons(observed, expected),
  ];
  return reasons.length === 0
    ? { status: "matching", image: observed }
    : { status: "conflict", reasons };
};

const OCI_IMAGE_INDEX_MEDIA_TYPE = "application/vnd.oci.image.index.v1+json";
const ATTESTATION_REFERENCE_TYPE = "attestation-manifest";

const isAttestationDescriptor = (descriptor: ImageIndexDescriptor) =>
  descriptor.annotations?.["vnd.docker.reference.type"] ===
    ATTESTATION_REFERENCE_TYPE &&
  descriptor.platform?.os === "unknown" &&
  descriptor.platform?.architecture === "unknown";

const isLinuxAmd64Descriptor = (descriptor: ImageIndexDescriptor) =>
  descriptor.platform?.os === "linux" &&
  descriptor.platform?.architecture === "amd64";

export const findReleaseImageIndexErrors = (index: ImageIndex): string[] => {
  const errors: string[] = [];
  if (index.mediaType !== OCI_IMAGE_INDEX_MEDIA_TYPE) {
    errors.push(
      `image media type is ${index.mediaType ?? "missing"}; expected OCI index`,
    );
  }

  const descriptors = index.manifests ?? [];
  const runnable = descriptors.filter(
    (descriptor) => !isAttestationDescriptor(descriptor),
  );
  if (runnable.length !== 1) {
    errors.push(
      `image index has ${runnable.length} runnable manifests; expected 1`,
    );
  } else if (!isLinuxAmd64Descriptor(runnable[0]!)) {
    errors.push("image index runnable manifest is not linux/amd64");
  }
  return errors;
};

export const buildImmutableImageReference = ({
  imageRepository,
  tag,
  digest,
}: {
  imageRepository: string;
  tag: string;
  digest: string;
}) => {
  if (!parseReleaseTag(tag)) throw new Error(`Invalid release tag: ${tag}`);
  if (!isSha256Digest(digest))
    throw new Error(`Invalid image digest: ${digest}`);
  return `${imageRepository}:${tag}@${digest}`;
};

const requireReleaseTag = (releaseTag: string) => {
  if (!parseReleaseTag(releaseTag)) {
    throw new Error(`Invalid generated release tag: ${releaseTag}`);
  }
};

export const renderReleaseCompose = ({
  source,
  imageRepository,
  releaseTag,
}: {
  source: string;
  imageRepository: string;
  releaseTag: string;
}) => {
  requireReleaseTag(releaseTag);
  const count = countMatches(source, RELEASE_IMAGE_FALLBACK_PATTERN);
  if (count !== 2) {
    throw new Error(
      `Expected 2 Staaash image fallbacks in Compose source; found ${count}.`,
    );
  }

  return source.replaceAll(
    "ghcr.io/itsmeares/staaash:${STAAASH_VERSION:-latest}",
    `${imageRepository}:\${STAAASH_VERSION:-${releaseTag}}`,
  );
};

export const renderReleaseEnv = ({
  source,
  releaseTag,
}: {
  source: string;
  releaseTag: string;
}) => {
  requireReleaseTag(releaseTag);
  const count = countMatches(source, RELEASE_ENV_VERSION_PATTERN);
  if (count !== 1) {
    throw new Error(
      `Expected 1 STAAASH_VERSION=latest entry in env source; found ${count}.`,
    );
  }

  return source.replace(
    RELEASE_ENV_VERSION_PATTERN,
    `STAAASH_VERSION=${releaseTag}`,
  );
};

export const findResolvedReleaseImageErrors = ({
  images,
  expectedReference,
}: {
  images: string[];
  expectedReference: string;
}): string[] => {
  if (images.length !== 2) {
    return [`resolved ${images.length} Staaash images; expected 2`];
  }
  return images.every((image) => image === expectedReference)
    ? []
    : [
        `resolved Staaash images ${images.join(", ")}; expected ${expectedReference}`,
      ];
};

export const buildReleaseManifest = ({
  release,
  repository,
  commit,
  tagObject,
  tagType,
  imageRepository,
  imageDigest,
}: {
  release: ReleaseTag;
  repository: string;
  commit: string;
  tagObject: string;
  tagType: "annotated" | "lightweight";
  imageRepository: string;
  imageDigest: string;
}): ReleaseManifest => {
  const immutableReference = buildImmutableImageReference({
    imageRepository,
    tag: release.tag,
    digest: imageDigest,
  });
  const source = `https://github.com/${repository}`;

  return {
    schemaVersion: 1,
    tag: release.tag,
    version: release.version,
    prerelease: release.prerelease,
    source: {
      repository,
      commit,
      tagObject,
      tagType,
    },
    image: {
      repository: imageRepository,
      tag: release.tag,
      indexDigest: imageDigest,
      immutableReference,
      platforms: ["linux/amd64"],
      labels: {
        version: release.tag,
        revision: commit,
        source,
      },
    },
  };
};

export const serializeReleaseManifest = (manifest: ReleaseManifest) =>
  `${JSON.stringify(manifest, null, 2)}\n`;

export const buildAssetChecksums = (assets: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(assets)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, content]) => [name, hashReleaseContent(content)]),
  );

export const serializeSha256Sums = (checksums: Record<string, string>) =>
  `${Object.entries(checksums)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, digest]) => `${digest.replace(/^sha256:/u, "")}  ${name}`)
    .join("\n")}\n`;

export const buildReleaseProvenance = ({
  tag,
  commit,
  tagObject,
  imageDigest = "pending",
  immutableImage = "pending",
  assetChecksums = null,
}: Omit<ReleaseProvenance, "schemaVersion">): ReleaseProvenance => ({
  schemaVersion: 1,
  tag,
  commit,
  tagObject,
  imageDigest,
  immutableImage,
  assetChecksums,
});

export const serializeReleaseProvenanceBlock = (
  provenance: ReleaseProvenance,
) =>
  `${RELEASE_PROVENANCE_START}\n<!-- ${JSON.stringify(provenance)} -->\n${RELEASE_PROVENANCE_END}`;

type ParsedReleaseProvenance =
  | { status: "absent" }
  | { status: "valid"; provenance: ReleaseProvenance; block: string }
  | { status: "malformed"; reason: string };

const findReleaseProvenanceBlock = (
  body: string,
):
  | { status: "absent" }
  | { status: "valid"; block: string }
  | {
      status: "malformed";
      reason: string;
    } => {
  const startCount = body.split(RELEASE_PROVENANCE_START).length - 1;
  const endCount = body.split(RELEASE_PROVENANCE_END).length - 1;
  if (startCount === 0 && endCount === 0) return { status: "absent" };
  if (startCount !== 1 || endCount !== 1) {
    return { status: "malformed", reason: "duplicate or unbalanced markers" };
  }

  const start = body.indexOf(RELEASE_PROVENANCE_START);
  const end = body.indexOf(RELEASE_PROVENANCE_END, start);
  if (end < start) {
    return { status: "malformed", reason: "markers are reversed" };
  }
  return {
    status: "valid",
    block: body.slice(start, end + RELEASE_PROVENANCE_END.length),
  };
};

const hasReleaseProvenanceStrings = (provenance: Partial<ReleaseProvenance>) =>
  ["tag", "commit", "tagObject", "imageDigest", "immutableImage"].every(
    (key) => typeof provenance[key as keyof ReleaseProvenance] === "string",
  );

const hasReleaseAssetChecksums = (
  value: ReleaseProvenance["assetChecksums"] | undefined,
) => {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((digest) => typeof digest === "string");
};

const isReleaseProvenance = (
  provenance: Partial<ReleaseProvenance>,
): provenance is ReleaseProvenance =>
  provenance.schemaVersion === 1 &&
  hasReleaseProvenanceStrings(provenance) &&
  hasReleaseAssetChecksums(provenance.assetChecksums);

const parseReleaseProvenanceBlock = (
  block: string,
): ParsedReleaseProvenance => {
  const payload = block
    .slice(RELEASE_PROVENANCE_START.length, -RELEASE_PROVENANCE_END.length)
    .trim();
  const match = /^<!-- (\{.*\}) -->$/su.exec(payload);
  if (!match) return { status: "malformed", reason: "payload is not JSON" };

  try {
    const provenance = JSON.parse(match[1]!) as Partial<ReleaseProvenance>;
    return isReleaseProvenance(provenance)
      ? { status: "valid", provenance, block }
      : { status: "malformed", reason: "payload shape is invalid" };
  } catch {
    return { status: "malformed", reason: "payload JSON is invalid" };
  }
};

export const parseReleaseProvenance = (
  body: string,
): ParsedReleaseProvenance => {
  const located = findReleaseProvenanceBlock(body);
  return located.status === "valid"
    ? parseReleaseProvenanceBlock(located.block)
    : located;
};

export const appendReleaseProvenance = ({
  body,
  provenance,
}: {
  body: string;
  provenance: ReleaseProvenance;
}) => {
  const parsed = parseReleaseProvenance(body);
  if (parsed.status !== "absent") {
    throw new Error("Release provenance already exists or is malformed.");
  }

  const separator = body.trim().length > 0 ? "\n\n" : "";
  return `${body.trimEnd()}${separator}${serializeReleaseProvenanceBlock(provenance)}\n`;
};

export const replaceReleaseProvenance = ({
  body,
  expected,
  next,
}: {
  body: string;
  expected: ReleaseProvenance;
  next: ReleaseProvenance;
}) => {
  const parsed = parseReleaseProvenance(body);
  if (parsed.status !== "valid") {
    throw new Error("Release provenance is missing or malformed.");
  }
  if (JSON.stringify(parsed.provenance) !== JSON.stringify(expected)) {
    throw new Error("Release provenance does not match expected state.");
  }

  return body.replace(parsed.block, serializeReleaseProvenanceBlock(next));
};

export const planReleaseAssets = ({
  expected,
  observed,
  published,
}: {
  expected: Record<string, string>;
  observed: ReleaseAsset[];
  published: boolean;
}): AssetPlan => {
  const observedByName = new Map(observed.map((asset) => [asset.name, asset]));
  const upload: string[] = [];
  const matching: string[] = [];
  const conflicts: string[] = [];

  for (const [name, digest] of Object.entries(expected).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const asset = observedByName.get(name);
    if (!asset) {
      if (published)
        conflicts.push(`${name} is missing from published release`);
      else upload.push(name);
      continue;
    }
    if (asset.digest !== digest) {
      conflicts.push(
        `${name} has ${asset.digest ?? "unknown digest"}; expected ${digest}`,
      );
      continue;
    }
    matching.push(name);
  }

  return { upload, matching, conflicts };
};

const planMatchingLatestDigest = ({
  candidateRevision,
  latest,
}: {
  candidateRevision: string;
  latest: LatestImage;
}): LatestPlan =>
  latest.revision === candidateRevision
    ? { action: "noop", reason: "matching" }
    : {
        action: "conflict",
        reason: "latest digest matches but revision differs",
      };

const planDifferentLatestDigest = ({
  candidateVersion,
  latest,
}: {
  candidateVersion: string;
  latest: LatestImage;
}): LatestPlan => {
  if (!latest.version || !parseSemanticVersion(latest.version)) {
    return { action: "conflict", reason: "latest version metadata is invalid" };
  }

  const comparison = compareSemanticVersions(latest.version, candidateVersion);
  if (comparison > 0) {
    return { action: "superseded", reason: "newer-version" };
  }
  return comparison === 0
    ? {
        action: "conflict",
        reason: "latest has same version but a different digest",
      }
    : { action: "promote", reason: "older" };
};

const planExistingLatest = ({
  candidateVersion,
  candidateDigest,
  candidateRevision,
  latest,
}: {
  candidateVersion: string;
  candidateDigest: string;
  candidateRevision: string;
  latest: LatestImage;
}): LatestPlan => {
  if (!isSha256Digest(latest.digest)) {
    return { action: "conflict", reason: "latest digest is invalid" };
  }
  return latest.digest === candidateDigest
    ? planMatchingLatestDigest({ candidateRevision, latest })
    : planDifferentLatestDigest({ candidateVersion, latest });
};

export const planLatestPromotion = ({
  candidateVersion,
  candidateDigest,
  candidateRevision,
  latest,
}: {
  candidateVersion: string;
  candidateDigest: string;
  candidateRevision: string;
  latest: LatestImage | null;
}): LatestPlan => {
  if (isPrereleaseVersion(candidateVersion)) {
    return { action: "skip-prerelease" };
  }
  if (!isSha256Digest(candidateDigest)) {
    return { action: "conflict", reason: "candidate digest is invalid" };
  }
  return latest
    ? planExistingLatest({
        candidateVersion,
        candidateDigest,
        candidateRevision,
        latest,
      })
    : { action: "promote", reason: "missing" };
};
