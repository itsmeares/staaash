import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  appendReleaseProvenance,
  buildAssetChecksums,
  buildReleaseManifest,
  buildReleaseProvenance,
  classifyImageState,
  findCanonicalReleaseVersionErrors,
  findReleaseImageIndexErrors,
  findResolvedReleaseImageErrors,
  hashReleaseContent,
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
} from "../../packages/config/dist/release.js";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const TOOLING_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PACKAGE_FILES = {
  root: "package.json",
  web: "apps/web/package.json",
  worker: "apps/worker/package.json",
  config: "packages/config/package.json",
  db: "packages/db/package.json",
};
const REQUIRED_ASSET_NAMES = [
  "docker-compose.yml",
  "example.env",
  "release-manifest.json",
  "SHA256SUMS",
];
const GITHUB_API_VERSION = "2022-11-28";
const MISSING_IMAGE_PATTERN =
  /manifest unknown|not found|no such manifest|does not exist/iu;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const requiredEnv = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

const optionalEnv = (name) => process.env[name]?.trim() ?? "";

const requiredAbsolutePath = (name) => {
  const value = requiredEnv(name);
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  return path.normalize(value);
};

const releaseSourceRoot = () => requiredAbsolutePath("RELEASE_SOURCE_ROOT");

const run = (
  command,
  args,
  {
    allowFailure = false,
    cwd = TOOLING_ROOT,
    input,
    encoding = "utf8",
    environment = process.env,
  } = {},
) => {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding,
    input,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : "."}`,
    );
  }
  return result;
};

const gitAt = (cwd, ...args) => run("git", args, { cwd }).stdout.trim();

const git = (...args) => gitAt(releaseSourceRoot(), ...args);

const toolingGit = (...args) => gitAt(TOOLING_ROOT, ...args);

const ghApi = (endpoint, { method = "GET", input } = {}) => {
  const args = ["api", endpoint, "--method", method];
  if (input !== undefined) args.push("--input", "-");
  const result = run("gh", args, {
    input: input === undefined ? undefined : JSON.stringify(input),
  });
  const output = result.stdout.trim();
  return output ? JSON.parse(output) : null;
};

const ghApiPaginated = (endpoint) => {
  const result = run("gh", ["api", "--paginate", "--slurp", endpoint]);
  const pages = JSON.parse(result.stdout);
  return pages.flat();
};

const writeOutput = async (name, value) => {
  const outputPath = optionalEnv("GITHUB_OUTPUT");
  if (!outputPath) {
    console.info(`${name}=${String(value)}`);
    return;
  }
  await writeFile(outputPath, `${name}=${String(value)}\n`, { flag: "a" });
};

const writeOutputs = async (entries) => {
  for (const [name, value] of entries) await writeOutput(name, value);
};

const writeSummary = async (content) => {
  const summaryPath = optionalEnv("GITHUB_STEP_SUMMARY");
  if (!summaryPath) return;
  await writeFile(summaryPath, `${content.trim()}\n`, { flag: "a" });
};

const sha256 = (content) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const verifyToolingRoot = () => {
  const expectedRoot = optionalEnv("TOOLING_ROOT");
  if (
    expectedRoot &&
    path.resolve(expectedRoot) !== path.resolve(TOOLING_ROOT)
  ) {
    throw new Error(
      `Tooling root is ${TOOLING_ROOT}; expected ${path.resolve(expectedRoot)}.`,
    );
  }
};

const verifyToolingCheckout = (toolingSha) => {
  verifyToolingRoot();
  const head = toolingGit("rev-parse", "HEAD");
  if (head !== toolingSha) {
    throw new Error(`Tooling HEAD is ${head}; expected ${toolingSha}.`);
  }
};

const releaseContextFromEnv = () => {
  const toolingSha = requiredEnv("TOOLING_SHA");
  verifyToolingCheckout(toolingSha);
  const tag = requiredEnv("RELEASE_TAG");
  const release = parseReleaseTag(tag);
  if (!release) throw new Error(`Invalid release tag: ${tag}`);
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const imageRepository =
    optionalEnv("IMAGE_REPOSITORY") || `ghcr.io/${repository.toLowerCase()}`;

  return {
    release,
    repository,
    imageRepository,
    sourceUrl: `https://github.com/${repository}`,
    releaseSha: requiredEnv("RELEASE_SHA"),
    tagObject: requiredEnv("TAG_OBJECT_SHA"),
    tagType: requiredEnv("TAG_TYPE"),
    toolingSha,
  };
};

const readPackageVersions = async (sourceRoot = releaseSourceRoot()) =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(PACKAGE_FILES).map(async ([name, file]) => {
        const metadata = JSON.parse(
          await readFile(path.join(sourceRoot, file), "utf8"),
        );
        return [name, metadata.version];
      }),
    ),
  );

const readRemoteTagObject = (tag) => {
  const result = run("git", ["ls-remote", "origin", `refs/tags/${tag}`], {
    cwd: releaseSourceRoot(),
  });
  const line = result.stdout.trim();
  if (!line) throw new Error(`Remote tag ${tag} does not exist.`);
  const [objectSha] = line.split(/\s+/u);
  return objectSha;
};

const resolveTagIdentity = (tag) => {
  const tagObject = git("rev-parse", `refs/tags/${tag}`);
  const releaseSha = git("rev-parse", `refs/tags/${tag}^{commit}`);
  const objectType = git("cat-file", "-t", tagObject);
  return {
    tagObject,
    releaseSha,
    tagType: objectType === "tag" ? "annotated" : "lightweight",
  };
};

const verifyRemoteTagIdentity = (tag, identity) => {
  const remoteTagObject = readRemoteTagObject(tag);
  if (remoteTagObject !== identity.tagObject) {
    throw new Error(
      `Remote tag object changed: expected ${identity.tagObject}; found ${remoteTagObject}.`,
    );
  }
};

const normalizeExpectedTagIdentity = (value) =>
  /^[0-9a-f]{40}$/u.test(value) && !/^0{40}$/u.test(value) ? value : "";

const verifyExpectedTagIdentity = ({
  identity,
  expectedReleaseSha,
  expectedTagObject,
}) => {
  const expectedObject = normalizeExpectedTagIdentity(expectedTagObject);
  if (
    expectedObject &&
    identity.tagObject !== expectedObject &&
    identity.releaseSha !== expectedObject
  ) {
    throw new Error(
      `Tag event identity is ${expectedObject}; current tag is ${identity.tagObject} at ${identity.releaseSha}.`,
    );
  }
  if (
    expectedReleaseSha &&
    identity.releaseSha !== expectedReleaseSha &&
    identity.tagObject !== expectedReleaseSha
  ) {
    throw new Error(
      `Tag event SHA is ${expectedReleaseSha}; current tag is ${identity.tagObject} at ${identity.releaseSha}.`,
    );
  }
};

const verifyCheckedOutTag = (releaseSha) => {
  const head = git("rev-parse", "HEAD");
  if (head !== releaseSha) {
    throw new Error(`Checked-out HEAD is ${head}; expected ${releaseSha}.`);
  }
};

const verifyMainAncestry = (releaseSha) => {
  const cwd = releaseSourceRoot();
  run(
    "git",
    ["fetch", "--no-tags", "origin", "main:refs/remotes/origin/main"],
    {
      cwd,
    },
  );
  const ancestry = run(
    "git",
    ["merge-base", "--is-ancestor", releaseSha, "origin/main"],
    { allowFailure: true, cwd },
  );
  if (ancestry.status !== 0) {
    throw new Error(`Release commit ${releaseSha} is not on current main.`);
  }
};

const inspectTagIdentity = ({
  tag,
  expectedReleaseSha = "",
  expectedTagObject = "",
  requireHead = true,
}) => {
  const identity = resolveTagIdentity(tag);
  verifyRemoteTagIdentity(tag, identity);
  verifyExpectedTagIdentity({
    identity,
    expectedReleaseSha,
    expectedTagObject,
  });
  if (requireHead) verifyCheckedOutTag(identity.releaseSha);
  verifyMainAncestry(identity.releaseSha);
  return identity;
};

const verifyRecordedTagIdentity = (context) => {
  const identity = inspectTagIdentity({
    tag: context.release.tag,
    expectedReleaseSha: context.releaseSha,
    expectedTagObject: context.tagObject,
  });
  if (identity.tagType !== context.tagType) {
    throw new Error(
      `Tag type changed: expected ${context.tagType}; found ${identity.tagType}.`,
    );
  }
};

const getExactCiRuns = (repository, releaseSha) => {
  const response = ghApi(
    `repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${releaseSha}&event=push&per_page=100`,
  );
  return response?.workflow_runs ?? [];
};

const evaluateExactCiState = ({ state, releaseSha, deadline }) => {
  if (state.status === "success") return state.run;
  if (state.status === "failure") {
    throw new Error(
      `Exact CI run ${state.run.id} completed with ${state.run.conclusion}.`,
    );
  }
  if (Date.now() >= deadline) {
    throw new Error(
      `No successful exact main-push CI run for ${releaseSha} before timeout.`,
    );
  }
  console.info(
    state.status === "missing"
      ? `Exact CI run for ${releaseSha} not visible yet.`
      : `Exact CI run ${state.run.id} is ${state.run.status}.`,
  );
  return null;
};

const waitForExactCi = async ({ repository, releaseSha }) => {
  const timeoutSeconds = Number.parseInt(
    optionalEnv("CI_WAIT_SECONDS") || "1800",
    10,
  );
  const pollSeconds = Number.parseInt(
    optionalEnv("CI_POLL_SECONDS") || "15",
    10,
  );
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (true) {
    const state = selectExactCiState({
      runs: getExactCiRuns(repository, releaseSha),
      releaseSha,
    });
    const completedRun = evaluateExactCiState({ state, releaseSha, deadline });
    if (completedRun) return completedRun;
    await sleep(pollSeconds * 1000);
  }
};

const getReleases = (repository) =>
  ghApiPaginated(`repos/${repository}/releases?per_page=100`);

const getRelease = (repository, tag) => {
  const releases = getReleases(repository).filter(
    (release) => release.tag_name === tag,
  );
  if (releases.length > 1) {
    throw new Error(`Multiple GitHub Releases exist for ${tag}.`);
  }
  return releases[0] ?? null;
};

const getReleaseAssets = (repository, releaseId) =>
  ghApiPaginated(
    `repos/${repository}/releases/${releaseId}/assets?per_page=100`,
  );

const verifyReleaseMetadata = ({ release, context }) => {
  if (release.tag_name !== context.release.tag) {
    throw new Error(
      `Release tag is ${release.tag_name}; expected ${context.release.tag}.`,
    );
  }
  if (Boolean(release.prerelease) !== context.release.prerelease) {
    throw new Error(
      `Release prerelease flag is ${String(release.prerelease)}; expected ${String(context.release.prerelease)}.`,
    );
  }
};

const requireReleaseProvenance = (body) => {
  const parsed = parseReleaseProvenance(body ?? "");
  if (parsed.status === "valid") return parsed;
  const detail = parsed.status === "malformed" ? `: ${parsed.reason}` : ".";
  throw new Error(`Release provenance is ${parsed.status}${detail}`);
};

const verifyReleaseProvenanceIdentity = ({ provenance, context }) => {
  const matches =
    provenance.tag === context.release.tag &&
    provenance.commit === context.releaseSha &&
    provenance.tagObject === context.tagObject;
  if (!matches) {
    throw new Error(
      "Release provenance tag identity conflicts with current tag.",
    );
  }
};

const validateReleaseIdentity = ({ release, context }) => {
  verifyReleaseMetadata({ release, context });
  const parsed = requireReleaseProvenance(release.body);
  verifyReleaseProvenanceIdentity({ provenance: parsed.provenance, context });
  if (!release.draft && parsed.provenance.imageDigest === "pending") {
    throw new Error("Published release still has pending image provenance.");
  }
  return { parsed, provenance: parsed.provenance };
};

const generateReleaseNotes = (repository, tag) =>
  ghApi(`repos/${repository}/releases/generate-notes`, {
    method: "POST",
    input: { tag_name: tag },
  });

const createDraft = ({ context, provenance }) => {
  const generated = generateReleaseNotes(
    context.repository,
    context.release.tag,
  );
  const body = appendReleaseProvenance({
    body: generated.body ?? "",
    provenance,
  });
  return ghApi(`repos/${context.repository}/releases`, {
    method: "POST",
    input: {
      tag_name: context.release.tag,
      name: generated.name || context.release.tag,
      body,
      draft: true,
      prerelease: context.release.prerelease,
      make_latest: "false",
    },
  });
};

const patchRelease = (repository, releaseId, input) =>
  ghApi(`repos/${repository}/releases/${releaseId}`, {
    method: "PATCH",
    input,
  });

const runImageInspection = (reference, allowMissing) => {
  const result = run(
    "docker",
    ["buildx", "imagetools", "inspect", reference, "--format", "{{json .}}"],
    { allowFailure: allowMissing },
  );
  if (result.status === 0) return result.stdout;

  const detail = `${result.stderr}\n${result.stdout}`;
  if (allowMissing && MISSING_IMAGE_PATTERN.test(detail)) return null;
  throw new Error(`Unable to inspect image ${reference}: ${detail.trim()}`);
};

const getInspectionManifest = (inspected) =>
  inspected.manifest ?? { digest: null, mediaType: null, manifests: [] };

const getInspectionConfig = (inspected) =>
  inspected.image?.config ?? { Labels: {}, Env: [] };

const parseImageInspection = (reference, output) => {
  const inspected = JSON.parse(output);
  const manifest = getInspectionManifest(inspected);
  const config = getInspectionConfig(inspected);
  const indexErrors = findReleaseImageIndexErrors(manifest);
  if (indexErrors.length > 0) {
    throw new Error(
      `${reference} has invalid image index:\n${indexErrors.join("\n")}`,
    );
  }
  return {
    digest: manifest.digest,
    labels: config.Labels ?? {},
    environment: config.Env ?? [],
  };
};

const inspectImage = (reference, { allowMissing = false } = {}) => {
  const output = runImageInspection(reference, allowMissing);
  return output === null ? null : parseImageInspection(reference, output);
};

const inspectRuntimeVersions = (reference) => {
  const program = [
    'const fs = require("node:fs");',
    'const webVersion = JSON.parse(fs.readFileSync("/app/apps/web/package.json", "utf8")).version;',
    'const workerVersion = JSON.parse(fs.readFileSync("/worker/package.json", "utf8")).version;',
    'import("file:///worker/dist/runtime-version.js")',
    "  .then(({ resolveWorkerVersion }) => {",
    "    const resolvedWorkerVersion = resolveWorkerVersion(null);",
    "    process.stdout.write(JSON.stringify({ webVersion, workerVersion, resolvedWorkerVersion }));",
    "  })",
    "  .catch((error) => { console.error(error); process.exit(1); });",
  ].join("\n");
  const result = run("docker", [
    "run",
    "--rm",
    "--pull=always",
    "--entrypoint",
    "node",
    reference,
    "-e",
    program,
  ]);
  return JSON.parse(result.stdout);
};

const readObservedImage = (reference) => {
  const inspected = inspectImage(reference);
  if (
    inspected.environment.some(
      (entry) => entry === "APP_VERSION" || entry.startsWith("APP_VERSION="),
    )
  ) {
    throw new Error(`${reference} defines APP_VERSION in image config.`);
  }
  const runtime = inspectRuntimeVersions(reference);
  if (runtime.workerVersion !== runtime.resolvedWorkerVersion) {
    throw new Error(
      `Worker package version ${runtime.workerVersion} resolves as ${runtime.resolvedWorkerVersion}.`,
    );
  }

  return {
    digest: inspected.digest,
    version: inspected.labels["org.opencontainers.image.version"] ?? null,
    revision: inspected.labels["org.opencontainers.image.revision"] ?? null,
    source: inspected.labels["org.opencontainers.image.source"] ?? null,
    webVersion: runtime.webVersion,
    workerVersion: runtime.resolvedWorkerVersion,
  };
};

const verifyImage = ({ context, digest }) => {
  const exactReference = `${context.imageRepository}:${context.release.tag}`;
  const immutableReference = `${exactReference}@${digest}`;
  const observed = readObservedImage(immutableReference);
  const state = classifyImageState({
    observed,
    expected: {
      digest,
      version: context.release.tag,
      revision: context.releaseSha,
      source: context.sourceUrl,
    },
  });
  if (state.status !== "matching") {
    throw new Error(`Image conflict:\n${state.reasons.join("\n")}`);
  }

  const exactInspected = inspectImage(exactReference);
  if (exactInspected.digest !== digest) {
    throw new Error(
      `Exact tag resolves to ${exactInspected.digest}; expected ${digest}.`,
    );
  }
  return { observed, immutableReference };
};

const assetDirectory = () => requiredAbsolutePath("ASSET_DIR");

const generatedAssets = async () => {
  const directory = assetDirectory();
  const entries = await Promise.all(
    REQUIRED_ASSET_NAMES.map(async (name) => [
      name,
      await readFile(path.join(directory, name), "utf8"),
    ]),
  );
  return Object.fromEntries(entries);
};

const expectedAssetDigests = (assets) =>
  Object.fromEntries(
    Object.entries(assets).map(([name, content]) => [
      name,
      hashReleaseContent(content),
    ]),
  );

const withoutStaaashVersion = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name.toUpperCase() !== "STAAASH_VERSION",
    ),
  );

const resolveComposeImages = ({ directory, environment }) => {
  const result = run(
    "docker",
    [
      "compose",
      "--env-file",
      path.join(directory, "example.env"),
      "-f",
      path.join(directory, "docker-compose.yml"),
      "config",
      "--images",
    ],
    { environment },
  );
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
};

const requireResolvedReleaseImages = ({
  images,
  imageRepository,
  expectedReference,
  mode,
}) => {
  const applicationImages = images.filter((image) =>
    image.startsWith(`${imageRepository}:`),
  );
  const errors = findResolvedReleaseImageErrors({
    images: applicationImages,
    expectedReference,
  });
  if (errors.length > 0) {
    throw new Error(
      `Generated Compose ${mode} resolution failed:\n${errors.join("\n")}`,
    );
  }
};

const validateRenderedAssets = ({
  directory,
  imageRepository,
  releaseTag,
  immutableReference,
}) => {
  const baseEnvironment = withoutStaaashVersion();
  requireResolvedReleaseImages({
    images: resolveComposeImages({
      directory,
      environment: baseEnvironment,
    }),
    imageRepository,
    expectedReference: `${imageRepository}:${releaseTag}`,
    mode: "tag default",
  });

  const immutableVersion = immutableReference.slice(
    `${imageRepository}:`.length,
  );
  requireResolvedReleaseImages({
    images: resolveComposeImages({
      directory,
      environment: {
        ...baseEnvironment,
        STAAASH_VERSION: immutableVersion,
      },
    }),
    imageRepository,
    expectedReference: immutableReference,
    mode: "immutable override",
  });
};

const fetchAssetBytes = async (asset) => {
  const token = requiredEnv("GH_TOKEN");
  const response = await fetch(asset.url, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Downloading release asset ${asset.name} failed: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
};

const encodeQueryValue = (value) =>
  encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const isValidReleaseAssetUploadUrl = ({ url, releaseId }) =>
  [
    url.protocol === "https:",
    url.hostname === "uploads.github.com",
    url.username === "",
    url.password === "",
    url.hash === "",
    url.search === "",
    url.pathname.endsWith(`/releases/${releaseId}/assets`),
  ].every(Boolean);

const releaseAssetUploadUrl = ({ release, name }) => {
  if (!release.upload_url) {
    throw new Error(`Release ${release.id} has no asset upload URL.`);
  }
  const url = new URL(release.upload_url.split("{", 1)[0]);
  if (!isValidReleaseAssetUploadUrl({ url, releaseId: release.id })) {
    throw new Error(`Release ${release.id} has an invalid asset upload URL.`);
  }
  url.search = `?name=${encodeQueryValue(name)}`;
  return url.href;
};

const safeGitHubResponseText = (text) =>
  text
    .replace(/\p{Cc}/gu, " ")
    .trim()
    .slice(0, 1000);

const uploadFailure = ({ name, status, detail }) =>
  new Error(
    [`Uploading release asset ${name} failed: HTTP ${status}`, detail]
      .filter(Boolean)
      .join(" "),
  );

const uploadNetworkFailure = ({ name, operation, error, token }) => {
  const rawDetail = error instanceof Error ? error.message : String(error);
  const detail = safeGitHubResponseText(
    rawDetail.replaceAll(token, "[redacted]"),
  );
  return new Error(
    `Uploading release asset ${name} failed during ${operation}${detail ? `: ${detail}` : "."}`,
  );
};

const hasExpectedUploadMetadata = ({ uploaded, name, size }) => {
  const metadata = Object(uploaded);
  const expected = { name, state: "uploaded", size };
  const valuesMatch = Object.entries(expected).every(
    ([key, value]) => metadata[key] === value,
  );
  const identifiersExist = ["id", "url"].every((key) => Boolean(metadata[key]));
  return valuesMatch && identifiersExist;
};

const parseUploadedAsset = ({ response, responseText, name, size }) => {
  if (response.status !== 201) {
    throw uploadFailure({
      name,
      status: response.status,
      detail: safeGitHubResponseText(responseText),
    });
  }

  let uploaded;
  try {
    uploaded = JSON.parse(responseText);
  } catch {
    throw uploadFailure({
      name,
      status: response.status,
      detail: "returned invalid JSON.",
    });
  }
  if (!hasExpectedUploadMetadata({ uploaded, name, size })) {
    throw uploadFailure({
      name,
      status: response.status,
      detail: "returned invalid asset metadata.",
    });
  }
  return uploaded;
};

const uploadReleaseAsset = async ({
  release,
  name,
  filePath,
  token = requiredEnv("GH_TOKEN"),
  fetchImpl = fetch,
  readAsset = readFile,
}) => {
  const content = await readAsset(filePath);
  let response;
  try {
    response = await fetchImpl(releaseAssetUploadUrl({ release, name }), {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
      body: content,
    });
  } catch (error) {
    throw uploadNetworkFailure({
      name,
      operation: "network request",
      error,
      token,
    });
  }

  let responseText;
  try {
    responseText = await response.text();
  } catch (error) {
    throw uploadNetworkFailure({
      name,
      operation: "response body read",
      error,
      token,
    });
  }
  return parseUploadedAsset({
    response,
    responseText,
    name,
    size: content.byteLength,
  });
};

const observedAssetsWithDigests = async (repository, releaseId) => {
  const assets = getReleaseAssets(repository, releaseId);
  return Promise.all(
    assets.map(async (asset) => ({
      ...asset,
      digest: asset.digest || sha256(await fetchAssetBytes(asset)),
    })),
  );
};

const verifyRemoteAssets = async ({ context, release, localAssets }) => {
  const expected = expectedAssetDigests(localAssets);
  const observed = await observedAssetsWithDigests(
    context.repository,
    release.id,
  );
  const plan = planReleaseAssets({
    expected,
    observed,
    published: !release.draft,
  });
  if (plan.upload.length > 0 || plan.conflicts.length > 0) {
    throw new Error(
      `Release assets are incomplete:\n${[
        ...plan.upload.map((name) => `${name} is missing`),
        ...plan.conflicts,
      ].join("\n")}`,
    );
  }

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "staaash-release-assets-"),
  );
  try {
    for (const name of REQUIRED_ASSET_NAMES) {
      const asset = observed.find((candidate) => candidate.name === name);
      if (!asset) throw new Error(`Release asset ${name} is missing.`);
      await writeFile(
        path.join(temporaryDirectory, name),
        await fetchAssetBytes(asset),
      );
    }

    const downloaded = Object.fromEntries(
      await Promise.all(
        REQUIRED_ASSET_NAMES.map(async (name) => [
          name,
          await readFile(path.join(temporaryDirectory, name), "utf8"),
        ]),
      ),
    );
    for (const name of REQUIRED_ASSET_NAMES) {
      if (downloaded[name] !== localAssets[name]) {
        throw new Error(
          `Downloaded release asset ${name} differs from generated file.`,
        );
      }
    }
    const manifest = JSON.parse(downloaded["release-manifest.json"]);
    validateRenderedAssets({
      directory: temporaryDirectory,
      imageRepository: context.imageRepository,
      releaseTag: manifest.tag,
      immutableReference: manifest.image.immutableReference,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
};

const expectedCompleteProvenance = ({ context, imageDigest, assets }) => {
  const assetChecksums = expectedAssetDigests(assets);
  return buildReleaseProvenance({
    tag: context.release.tag,
    commit: context.releaseSha,
    tagObject: context.tagObject,
    imageDigest,
    immutableImage: `${context.imageRepository}:${context.release.tag}@${imageDigest}`,
    assetChecksums,
  });
};

const verifyPreflightToolingIdentity = ({ toolingSha, releaseSha }) => {
  verifyToolingCheckout(toolingSha);
  const eventName = requiredEnv("RELEASE_EVENT_NAME");
  if (eventName === "push") {
    if (toolingSha !== releaseSha) {
      throw new Error(
        `Tag-push tooling is ${toolingSha}; expected release commit ${releaseSha}.`,
      );
    }
    return;
  }
  if (eventName !== "workflow_dispatch") {
    throw new Error(`Unsupported release event: ${eventName}.`);
  }
  const recoveryRef = requiredEnv("RECOVERY_REF");
  if (recoveryRef !== "refs/heads/main") {
    throw new Error(
      `Recovery dispatch ref is ${recoveryRef}; expected refs/heads/main.`,
    );
  }
  const expectedToolingSha = requiredEnv("EXPECTED_TOOLING_SHA");
  if (toolingSha !== expectedToolingSha) {
    throw new Error(
      `Recovery tooling is ${toolingSha}; expected ${expectedToolingSha}.`,
    );
  }
};

const waitForRequiredCi = async ({
  repository,
  releaseSha,
  toolingSha,
  waitForCi = waitForExactCi,
}) => {
  const releaseCiRun = await waitForCi({ repository, releaseSha });
  const toolingCiRun =
    toolingSha === releaseSha
      ? releaseCiRun
      : await waitForCi({ repository, releaseSha: toolingSha });
  return { releaseCiRun, toolingCiRun };
};

const commandPreflight = async () => {
  const tag = requiredEnv("RELEASE_TAG");
  const repository = requiredEnv("GITHUB_REPOSITORY");
  const toolingSha = requiredEnv("TOOLING_SHA");
  const identity = inspectTagIdentity({
    tag,
    expectedReleaseSha: optionalEnv("EXPECTED_RELEASE_SHA"),
    expectedTagObject: optionalEnv("EXPECTED_TAG_OBJECT"),
  });
  verifyPreflightToolingIdentity({
    toolingSha,
    releaseSha: identity.releaseSha,
  });
  const packageVersions = await readPackageVersions();
  const errors = findCanonicalReleaseVersionErrors({ tag, packageVersions });
  if (errors.length > 0) throw new Error(errors.join("\n"));
  const release = parseReleaseTag(tag);
  const { releaseCiRun, toolingCiRun } = await waitForRequiredCi({
    repository,
    releaseSha: identity.releaseSha,
    toolingSha,
  });
  const imageRepository = `ghcr.io/${repository.toLowerCase()}`;

  await writeOutputs([
    ["tag", release.tag],
    ["version", release.version],
    ["prerelease", release.prerelease],
    ["release_sha", identity.releaseSha],
    ["tag_object", identity.tagObject],
    ["tag_type", identity.tagType],
    ["image_repository", imageRepository],
    ["release_ci_run_id", releaseCiRun.id],
    ["tooling_sha", toolingSha],
    ["tooling_ci_run_id", toolingCiRun.id],
  ]);
  await writeSummary(
    `## REL-01 preflight\n\n- Tag: \`${release.tag}\`\n- Tag object: \`${identity.tagObject}\`\n- Release commit: \`${identity.releaseSha}\`\n- Release CI run: \`${releaseCiRun.id}\`\n- Tooling commit: \`${toolingSha}\`\n- Tooling CI run: \`${toolingCiRun.id}\`\n- Channel: ${release.prerelease ? "prerelease" : "stable"}`,
  );
};

const commandVerifyTag = async () => {
  verifyRecordedTagIdentity(releaseContextFromEnv());
};

const commandEnsureDraft = async () => {
  const context = releaseContextFromEnv();
  verifyRecordedTagIdentity(context);
  const pending = buildReleaseProvenance({
    tag: context.release.tag,
    commit: context.releaseSha,
    tagObject: context.tagObject,
    imageDigest: "pending",
    immutableImage: "pending",
    assetChecksums: null,
  });
  let release = getRelease(context.repository, context.release.tag);
  if (!release) release = createDraft({ context, provenance: pending });
  const { provenance } = validateReleaseIdentity({ release, context });
  if (release.draft && provenance.imageDigest !== "pending") {
    console.info(
      "Compatible draft already contains complete image provenance.",
    );
  }

  await writeOutputs([
    ["release_id", release.id],
    ["published", !release.draft],
  ]);
};

const commandInspectImage = async () => {
  const context = releaseContextFromEnv();
  verifyRecordedTagIdentity(context);
  const release = getRelease(context.repository, context.release.tag);
  if (!release)
    throw new Error("Draft release must exist before image inspection.");
  const { provenance } = validateReleaseIdentity({ release, context });
  const exactReference = `${context.imageRepository}:${context.release.tag}`;
  const inspected = inspectImage(exactReference, { allowMissing: true });
  if (!inspected) {
    if (!release.draft || provenance.imageDigest !== "pending") {
      throw new Error(
        "Recorded or published release image is missing from GHCR.",
      );
    }
    await writeOutput("exists", false);
    await writeOutput("digest", "");
    return;
  }

  const expectedDigest =
    provenance.imageDigest === "pending" ? undefined : provenance.imageDigest;
  const immutableReference = `${exactReference}@${inspected.digest}`;
  const observed = readObservedImage(immutableReference);
  const state = classifyImageState({
    observed,
    expected: {
      digest: expectedDigest,
      version: context.release.tag,
      revision: context.releaseSha,
      source: context.sourceUrl,
    },
  });
  if (state.status !== "matching") {
    throw new Error(`Existing image conflicts:\n${state.reasons.join("\n")}`);
  }

  await writeOutputs([
    ["exists", true],
    ["digest", observed.digest],
  ]);
};

const commandVerifyImage = async () => {
  const context = releaseContextFromEnv();
  verifyRecordedTagIdentity(context);
  const digest = requiredEnv("IMAGE_DIGEST");
  const { immutableReference } = verifyImage({ context, digest });
  await writeOutput("immutable_reference", immutableReference);
};

const readReleaseTemplates = async (sourceRoot = releaseSourceRoot()) => ({
  compose: await readFile(path.join(sourceRoot, "docker-compose.yml"), "utf8"),
  environment: await readFile(path.join(sourceRoot, "example.env"), "utf8"),
});

const commandGenerateAssets = async () => {
  const context = releaseContextFromEnv();
  const imageDigest = requiredEnv("IMAGE_DIGEST");
  verifyImage({ context, digest: imageDigest });
  const directory = assetDirectory();
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });

  const templates = await readReleaseTemplates();
  const compose = renderReleaseCompose({
    source: templates.compose,
    imageRepository: context.imageRepository,
    releaseTag: context.release.tag,
  });
  const environment = renderReleaseEnv({
    source: templates.environment,
    releaseTag: context.release.tag,
  });
  const manifestObject = buildReleaseManifest({
    release: context.release,
    repository: context.repository,
    commit: context.releaseSha,
    tagObject: context.tagObject,
    tagType: context.tagType,
    imageRepository: context.imageRepository,
    imageDigest,
  });
  const manifest = serializeReleaseManifest(manifestObject);
  const checksums = buildAssetChecksums({
    "docker-compose.yml": compose,
    "example.env": environment,
    "release-manifest.json": manifest,
  });
  const sums = serializeSha256Sums(checksums);

  await Promise.all([
    writeFile(path.join(directory, "docker-compose.yml"), compose),
    writeFile(path.join(directory, "example.env"), environment),
    writeFile(path.join(directory, "release-manifest.json"), manifest),
    writeFile(path.join(directory, "SHA256SUMS"), sums),
  ]);
  validateRenderedAssets({
    directory,
    imageRepository: context.imageRepository,
    releaseTag: context.release.tag,
    immutableReference: manifestObject.image.immutableReference,
  });
  if (
    compose.includes("${STAAASH_VERSION:-latest}") ||
    environment.includes("STAAASH_VERSION=latest")
  ) {
    throw new Error(
      "Generated release assets contain mutable latest defaults.",
    );
  }
};

const reconcileDraftProvenance = ({
  context,
  release,
  provenance,
  complete,
}) => {
  if (provenance.imageDigest === "pending") {
    const body = replaceReleaseProvenance({
      body: release.body ?? "",
      expected: provenance,
      next: complete,
    });
    return patchRelease(context.repository, release.id, { body });
  }
  if (JSON.stringify(provenance) !== JSON.stringify(complete)) {
    throw new Error(
      "Draft release provenance conflicts with generated assets.",
    );
  }
  return release;
};

const uploadMissingDraftAssets = async ({
  context,
  release,
  localAssets,
  observeAssets = observedAssetsWithDigests,
  uploadAsset = uploadReleaseAsset,
  refreshRelease = getRelease,
  assetRoot = assetDirectory,
}) => {
  const plan = planReleaseAssets({
    expected: expectedAssetDigests(localAssets),
    observed: await observeAssets(context.repository, release.id),
    published: false,
  });
  if (plan.conflicts.length > 0) {
    throw new Error(`Draft assets conflict:\n${plan.conflicts.join("\n")}`);
  }
  for (const name of plan.upload) {
    await uploadAsset({
      release,
      name,
      filePath: path.join(assetRoot(), name),
    });
  }
  const refreshed = refreshRelease(context.repository, context.release.tag);
  if (!refreshed)
    throw new Error("Draft release disappeared after asset upload.");
  return refreshed;
};

const reconcileDraftRelease = async ({
  context,
  release,
  provenance,
  complete,
  localAssets,
  uploadOptions,
}) => {
  const updated = reconcileDraftProvenance({
    context,
    release,
    provenance,
    complete,
  });
  return uploadMissingDraftAssets({
    context,
    release: updated,
    localAssets,
    ...uploadOptions,
  });
};

const verifyCompleteProvenance = ({ provenance, complete, published }) => {
  if (JSON.stringify(provenance) === JSON.stringify(complete)) return;
  throw new Error(
    `${published ? "Published" : "Draft"} release provenance conflicts with generated assets.`,
  );
};

const reconcileReleaseAssets = async ({
  context,
  release,
  provenance,
  complete,
  localAssets,
  uploadOptions,
  verifyAssets = verifyRemoteAssets,
}) => {
  let reconciled = release;
  if (release.draft) {
    reconciled = await reconcileDraftRelease({
      context,
      release,
      provenance,
      complete,
      localAssets,
      uploadOptions,
    });
  } else {
    verifyCompleteProvenance({ provenance, complete, published: true });
  }
  await verifyAssets({ context, release: reconciled, localAssets });
  return reconciled;
};

const commandReconcileRelease = async () => {
  const context = releaseContextFromEnv();
  const imageDigest = requiredEnv("IMAGE_DIGEST");
  verifyRecordedTagIdentity(context);
  const localAssets = await generatedAssets();
  const release = getRelease(context.repository, context.release.tag);
  if (!release) throw new Error("Draft release is missing.");
  const { provenance } = validateReleaseIdentity({ release, context });
  const complete = expectedCompleteProvenance({
    context,
    imageDigest,
    assets: localAssets,
  });

  await reconcileReleaseAssets({
    context,
    release,
    provenance,
    complete,
    localAssets,
  });
};

const commandPublish = async () => {
  const context = releaseContextFromEnv();
  const imageDigest = requiredEnv("IMAGE_DIGEST");
  verifyRecordedTagIdentity(context);
  verifyImage({ context, digest: imageDigest });
  const localAssets = await generatedAssets();
  let release = getRelease(context.repository, context.release.tag);
  if (!release) throw new Error("Release is missing before publication.");
  const { provenance } = validateReleaseIdentity({ release, context });
  const complete = expectedCompleteProvenance({
    context,
    imageDigest,
    assets: localAssets,
  });
  if (JSON.stringify(provenance) !== JSON.stringify(complete)) {
    throw new Error("Release provenance is incomplete before publication.");
  }
  await verifyRemoteAssets({ context, release, localAssets });
  verifyRecordedTagIdentity(context);

  if (release.draft) {
    release = patchRelease(context.repository, release.id, {
      draft: false,
      prerelease: context.release.prerelease,
      make_latest: "false",
    });
  }
  if (release.draft) throw new Error("GitHub Release remained a draft.");
  validateReleaseIdentity({ release, context });
  await verifyRemoteAssets({ context, release, localAssets });
  verifyRecordedTagIdentity(context);
};

const handlePrereleaseLatest = async ({ context, imageDigest }) => {
  const plan = planLatestPromotion({
    candidateVersion: context.release.version,
    candidateDigest: imageDigest,
    candidateRevision: context.releaseSha,
    latest: null,
  });
  if (plan.action !== "skip-prerelease") {
    throw new Error("Prerelease unexpectedly reached latest promotion.");
  }
  await writeSummary("## Docker `latest`\n\nPrerelease: promotion prohibited.");
};

const requirePublishedRelease = (context) => {
  const release = getRelease(context.repository, context.release.tag);
  if (!release || release.draft) {
    throw new Error("Stable GitHub Release must be published before latest.");
  }
  validateReleaseIdentity({ release, context });
  return release;
};

const toLatestImage = (inspected) =>
  inspected
    ? {
        digest: inspected.digest,
        version: inspected.labels["org.opencontainers.image.version"] ?? null,
        revision: inspected.labels["org.opencontainers.image.revision"] ?? null,
      }
    : null;

const applyLatestPlan = ({
  plan,
  latestReference,
  imageRepository,
  imageDigest,
}) => {
  if (plan.action === "conflict") throw new Error(plan.reason);
  if (plan.action !== "promote") return;
  run("docker", [
    "buildx",
    "imagetools",
    "create",
    "--tag",
    latestReference,
    `${imageRepository}@${imageDigest}`,
  ]);
};

const verifyLatestResult = ({
  plan,
  previousLatest,
  finalLatest,
  imageDigest,
}) => {
  const expectedDigest =
    plan.action === "superseded" ? previousLatest?.digest : imageDigest;
  if (finalLatest.digest !== expectedDigest) {
    throw new Error(
      `Latest resolves to ${finalLatest.digest}; expected ${expectedDigest}.`,
    );
  }
};

const markGitHubReleaseLatest = ({ context, release, plan }) => {
  if (plan.action === "superseded") return;
  patchRelease(context.repository, release.id, { make_latest: "true" });
  const latestRelease = ghApi(`repos/${context.repository}/releases/latest`);
  if (latestRelease.tag_name !== context.release.tag) {
    throw new Error(
      `GitHub latest release is ${latestRelease.tag_name}; expected ${context.release.tag}.`,
    );
  }
};

const promoteStableLatest = async ({ context, imageDigest }) => {
  verifyRecordedTagIdentity(context);
  const release = requirePublishedRelease(context);
  verifyImage({ context, digest: imageDigest });

  const latestReference = `${context.imageRepository}:latest`;
  const previousLatest = toLatestImage(
    inspectImage(latestReference, { allowMissing: true }),
  );
  const plan = planLatestPromotion({
    candidateVersion: context.release.version,
    candidateDigest: imageDigest,
    candidateRevision: context.releaseSha,
    latest: previousLatest,
  });
  verifyRecordedTagIdentity(context);
  applyLatestPlan({
    plan,
    latestReference,
    imageRepository: context.imageRepository,
    imageDigest,
  });
  const finalLatest = inspectImage(latestReference);
  verifyLatestResult({ plan, previousLatest, finalLatest, imageDigest });
  verifyRecordedTagIdentity(context);
  markGitHubReleaseLatest({ context, release, plan });
  verifyRecordedTagIdentity(context);
  await writeSummary(
    `## Docker \`latest\`\n\nAction: \`${plan.action}\`\nDigest: \`${finalLatest.digest}\``,
  );
};

const commandPromoteLatest = async () => {
  const context = releaseContextFromEnv();
  const imageDigest = requiredEnv("IMAGE_DIGEST");
  return context.release.prerelease
    ? handlePrereleaseLatest({ context, imageDigest })
    : promoteStableLatest({ context, imageDigest });
};

const commandSummary = async () => {
  const tag = optionalEnv("RELEASE_TAG") || "unknown";
  const releaseSha = optionalEnv("RELEASE_SHA") || "unknown";
  const tagObject = optionalEnv("TAG_OBJECT_SHA") || "unknown";
  const toolingSha = optionalEnv("TOOLING_SHA") || "unknown";
  const result = optionalEnv("RELEASE_RESULT") || "unknown";
  await writeSummary(
    `## Release recovery\n\nResult: **${result}**\n\n- Tag: \`${tag}\`\n- Tag object: \`${tagObject}\`\n- Release commit: \`${releaseSha}\`\n- Tooling commit: \`${toolingSha}\`\n\n- Retry matching partial state with **Run workflow** from \`main\` and the same existing tag.\n- Do not move/delete the tag, clobber assets, or overwrite a conflicting image.\n- Conflicts require manual comparison of reported expected and actual SHA/digest values.`,
  );
};

const commands = {
  preflight: commandPreflight,
  "verify-tag": commandVerifyTag,
  "ensure-draft": commandEnsureDraft,
  "inspect-image": commandInspectImage,
  "verify-image": commandVerifyImage,
  "generate-assets": commandGenerateAssets,
  "reconcile-release": commandReconcileRelease,
  publish: commandPublish,
  "promote-latest": commandPromoteLatest,
  summary: commandSummary,
};

export {
  assetDirectory,
  readPackageVersions,
  readReleaseTemplates,
  reconcileReleaseAssets,
  releaseAssetUploadUrl,
  resolveTagIdentity,
  uploadMissingDraftAssets,
  uploadReleaseAsset,
  verifyPreflightToolingIdentity,
  waitForRequiredCi,
  verifyToolingCheckout,
};

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const command = process.argv[2];
  if (!command || !(command in commands)) {
    throw new Error(`Unknown release command: ${command ?? "missing"}`);
  }

  try {
    await commands[command]();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await writeSummary(
      `## REL-01 failure\n\n\`\`\`text\n${message}\n\`\`\`\n\nRetry matching partial state with **Run workflow** from \`main\` and the same existing tag. Do not move/delete the tag, clobber assets, or overwrite a conflicting image. Conflicts require manual comparison of reported expected and actual SHA/digest values.`,
    );
    process.exitCode = 1;
  }
}
