import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  appendReleaseProvenance,
  buildReleaseProvenance,
} from "../src/release.js";

import {
  assetDirectory,
  getReleaseById,
  readPackageVersions,
  readReleaseTemplates,
  reconcileReleaseAssets,
  releaseAssetUploadUrl,
  requiredReleaseId,
  resolveReleaseById,
  resolveTagIdentity,
  uploadMissingDraftAssets,
  uploadReleaseAsset,
  validateResolvedRelease,
  verifyPreflightToolingIdentity,
  waitForRequiredCi,
} from "../../../scripts/release/index.mjs";

const localAssets = {
  "docker-compose.yml": "compose\n",
  "example.env": "environment\n",
  "release-manifest.json": "{}\n",
  SHA256SUMS: "checksums\n",
};

const digest = (content: string) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

const context = {
  repository: "itsmeares/staaash",
  release: { tag: "v1.0.0-rc.7", prerelease: true },
  releaseSha: "1".repeat(40),
  tagObject: "2".repeat(40),
};

const complete = buildReleaseProvenance({
  tag: "v1.0.0-rc.7",
  commit: context.releaseSha,
  tagObject: context.tagObject,
  imageDigest: `sha256:${"a".repeat(64)}`,
  immutableImage: `ghcr.io/itsmeares/staaash:v1.0.0-rc.7@sha256:${"a".repeat(64)}`,
  assetChecksums: {},
});

const release = {
  id: 42,
  tag_name: context.release.tag,
  draft: true,
  prerelease: true,
  body: appendReleaseProvenance({
    body: "Generated release notes.\n",
    provenance: complete,
  }),
  upload_url:
    "https://uploads.github.com/repos/itsmeares/staaash/releases/42/assets{?name,label}",
};

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("release trust roots", () => {
  it("reads package versions and templates only from release source", async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "release-source-"));
    try {
      const packageFiles = [
        "package.json",
        "apps/web/package.json",
        "apps/worker/package.json",
        "packages/config/package.json",
        "packages/db/package.json",
      ];
      await Promise.all(
        packageFiles.map(async (file, index) => {
          const target = path.join(sourceRoot, file);
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(
            target,
            JSON.stringify({ version: `source-${index}` }),
          );
        }),
      );
      await writeFile(
        path.join(sourceRoot, "docker-compose.yml"),
        "source compose\n",
      );
      await writeFile(path.join(sourceRoot, "example.env"), "source env\n");

      await expect(readPackageVersions(sourceRoot)).resolves.toEqual({
        root: "source-0",
        web: "source-1",
        worker: "source-2",
        config: "source-3",
        db: "source-4",
      });
      await expect(readReleaseTemplates(sourceRoot)).resolves.toEqual({
        compose: "source compose\n",
        environment: "source env\n",
      });
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("runs release Git identity against release source checkout", async () => {
    const sourceRoot = await mkdtemp(path.join(os.tmpdir(), "release-git-"));
    try {
      git(sourceRoot, "init");
      git(sourceRoot, "config", "user.name", "Release Test");
      git(sourceRoot, "config", "user.email", "release@example.com");
      await writeFile(path.join(sourceRoot, "source.txt"), "tagged source\n");
      git(sourceRoot, "add", "source.txt");
      git(sourceRoot, "commit", "-m", "tagged source");
      git(sourceRoot, "tag", "-a", "v1.2.3", "-m", "v1.2.3");
      vi.stubEnv("RELEASE_SOURCE_ROOT", sourceRoot);

      expect(resolveTagIdentity("v1.2.3")).toEqual({
        tagObject: git(sourceRoot, "rev-parse", "refs/tags/v1.2.3"),
        releaseSha: git(sourceRoot, "rev-parse", "HEAD"),
        tagType: "annotated",
      });
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  });

  it("requires exact CI for release and distinct recovery tooling commits", async () => {
    const waitForCi = vi.fn(async ({ releaseSha }: { releaseSha: string }) => ({
      id: releaseSha,
    }));

    await expect(
      waitForRequiredCi({
        repository: "itsmeares/staaash",
        releaseSha: "1".repeat(40),
        toolingSha: "2".repeat(40),
        waitForCi,
      }),
    ).resolves.toEqual({
      releaseCiRun: { id: "1".repeat(40) },
      toolingCiRun: { id: "2".repeat(40) },
    });
    expect(waitForCi).toHaveBeenCalledTimes(2);

    waitForCi.mockClear();
    await waitForRequiredCi({
      repository: "itsmeares/staaash",
      releaseSha: "1".repeat(40),
      toolingSha: "1".repeat(40),
      waitForCi,
    });
    expect(waitForCi).toHaveBeenCalledOnce();
  });

  it("requires absolute asset output and exact main recovery tooling", () => {
    vi.stubEnv("ASSET_DIR", "relative-assets");
    expect(() => assetDirectory()).toThrow(
      "ASSET_DIR must be an absolute path",
    );

    const absoluteAssets = path.join(repositoryRoot, "release-assets");
    vi.stubEnv("ASSET_DIR", absoluteAssets);
    expect(assetDirectory()).toBe(path.normalize(absoluteAssets));

    const toolingSha = git(repositoryRoot, "rev-parse", "HEAD");
    vi.stubEnv("TOOLING_ROOT", repositoryRoot);
    vi.stubEnv("RELEASE_EVENT_NAME", "workflow_dispatch");
    vi.stubEnv("RECOVERY_REF", "refs/heads/main");
    vi.stubEnv("EXPECTED_TOOLING_SHA", toolingSha);
    expect(() =>
      verifyPreflightToolingIdentity({
        toolingSha,
        releaseSha: "1".repeat(40),
      }),
    ).not.toThrow();

    vi.stubEnv("RECOVERY_REF", "refs/heads/hotfix");
    expect(() =>
      verifyPreflightToolingIdentity({
        toolingSha,
        releaseSha: "1".repeat(40),
      }),
    ).toThrow("expected refs/heads/main");

    vi.stubEnv("RECOVERY_REF", "refs/heads/main");
    vi.stubEnv("EXPECTED_TOOLING_SHA", "2".repeat(40));
    expect(() =>
      verifyPreflightToolingIdentity({
        toolingSha,
        releaseSha: "1".repeat(40),
      }),
    ).toThrow("Recovery tooling is");

    vi.stubEnv("RELEASE_EVENT_NAME", "push");
    expect(() =>
      verifyPreflightToolingIdentity({ toolingSha, releaseSha: toolingSha }),
    ).not.toThrow();
    expect(() =>
      verifyPreflightToolingIdentity({
        toolingSha,
        releaseSha: "1".repeat(40),
      }),
    ).toThrow("Tag-push tooling is");
  });
});

describe("exact release resolution", () => {
  it("accepts only canonical safe positive RELEASE_ID values", () => {
    vi.stubEnv("RELEASE_ID", "42");
    expect(requiredReleaseId()).toBe(42);

    for (const value of [
      "",
      "0",
      "-1",
      "01",
      "1.5",
      "release-42",
      "9".repeat(20),
    ]) {
      vi.stubEnv("RELEASE_ID", value);
      expect(() => requiredReleaseId()).toThrow(/RELEASE_ID/u);
    }
  });

  it("rejects an invalid RELEASE_ID before any exact lookup", () => {
    const fetchRelease = vi.fn();
    vi.stubEnv("RELEASE_ID", "0042");

    expect(() => resolveReleaseById({ context, fetchRelease })).toThrow(
      "RELEASE_ID must be a canonical positive integer.",
    );
    expect(fetchRelease).not.toHaveBeenCalled();
  });

  it("loads the exact release endpoint without collection or tag lookup", () => {
    const request = vi.fn(() => release);

    expect(getReleaseById(context.repository, release.id, { request })).toBe(
      release,
    );
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith("repos/itsmeares/staaash/releases/42");
  });

  it("reports a missing exact-ID release clearly", () => {
    expect(() =>
      getReleaseById(context.repository, release.id, {
        request: () => null,
      }),
    ).toThrow("GitHub Release ID 42 is missing.");
  });

  it("preserves non-missing API failures", () => {
    const failure = new Error("GitHub API failed with HTTP 500");

    expect(() =>
      getReleaseById(context.repository, release.id, {
        request: () => {
          throw failure;
        },
      }),
    ).toThrow(failure);
  });

  it("validates exact ID, tag, prerelease state, and provenance identity", () => {
    expect(
      resolveReleaseById({
        context,
        releaseId: release.id,
        fetchRelease: () => release,
      }),
    ).toEqual(expect.objectContaining({ release, provenance: complete }));

    expect(() =>
      resolveReleaseById({
        context,
        releaseId: release.id,
        fetchRelease: () => ({ ...release, id: 43 }),
      }),
    ).toThrow("Release ID is 43; expected 42.");
    expect(() =>
      resolveReleaseById({
        context,
        releaseId: release.id,
        fetchRelease: () => ({ ...release, tag_name: "v1.0.0-rc.6" }),
      }),
    ).toThrow("Release tag is v1.0.0-rc.6; expected v1.0.0-rc.7.");
    expect(() =>
      resolveReleaseById({
        context,
        releaseId: release.id,
        fetchRelease: () => ({ ...release, prerelease: false }),
      }),
    ).toThrow("Release prerelease flag is false; expected true.");
    expect(() =>
      resolveReleaseById({
        context,
        releaseId: release.id,
        fetchRelease: () => ({
          ...release,
          body: appendReleaseProvenance({
            body: "Generated release notes.\n",
            provenance: { ...complete, commit: "3".repeat(40) },
          }),
        }),
      }),
    ).toThrow("Release provenance tag identity conflicts with current tag.");
  });

  it("rejects invalid and switched IDs in mutation responses", () => {
    expect(() =>
      validateResolvedRelease({
        release: { ...release, id: "42" },
        context,
        releaseId: release.id,
      }),
    ).toThrow("GitHub Release returned an invalid numeric ID.");
    expect(() =>
      validateResolvedRelease({
        release: { ...release, id: 43 },
        context,
        releaseId: release.id,
      }),
    ).toThrow("Release ID is 43; expected 42.");
  });
});

describe("release asset upload orchestration", () => {
  it("constructs a release-specific upload URL with RFC 3986 encoding", () => {
    expect(
      releaseAssetUploadUrl({
        release,
        name: "release notes +#?%☃!'()*",
      }),
    ).toBe(
      "https://uploads.github.com/repos/itsmeares/staaash/releases/42/assets?name=release%20notes%20%2B%23%3F%25%E2%98%83%21%27%28%29%2A",
    );

    expect(() =>
      releaseAssetUploadUrl({
        release: {
          ...release,
          upload_url:
            "https://uploads.github.com/repos/itsmeares/staaash/releases/41/assets{?name,label}",
        },
        name: "asset.txt",
      }),
    ).toThrow("invalid asset upload URL");
    expect(() =>
      releaseAssetUploadUrl({
        release: {
          ...release,
          upload_url:
            "https://example.com/repos/itsmeares/staaash/releases/42/assets{?name,label}",
        },
        name: "asset.txt",
      }),
    ).toThrow("invalid asset upload URL");
  });

  it("uploads raw bytes with required GitHub headers and verifies response", async () => {
    const content = Buffer.from("asset bytes");
    const fetchImpl = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options).toEqual(
        expect.objectContaining({
          method: "POST",
          body: content,
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "Bearer token",
            "Content-Type": "application/octet-stream",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }),
      );
      return new Response(
        JSON.stringify({
          id: 7,
          url: "https://api.github.com/repos/itsmeares/staaash/releases/assets/7",
          name: "asset.bin",
          state: "uploaded",
          size: content.byteLength,
        }),
        { status: 201 },
      );
    });

    await expect(
      uploadReleaseAsset({
        release,
        name: "asset.bin",
        filePath: "unused",
        token: "token",
        fetchImpl,
        readAsset: async () => content,
      }),
    ).resolves.toEqual(expect.objectContaining({ id: 7, name: "asset.bin" }));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://uploads.github.com/repos/itsmeares/staaash/releases/42/assets?name=asset.bin",
      expect.any(Object),
    );
  });

  it("uploads only missing assets without clobbering or deleting", async () => {
    const uploaded: string[] = [];
    const refreshed = { ...release };
    const uploadAsset = vi.fn(async ({ name }: { name: string }) => {
      uploaded.push(name);
    });
    const refreshRelease = vi.fn(() => refreshed);

    await expect(
      uploadMissingDraftAssets({
        context,
        release,
        localAssets,
        observeAssets: async () => [
          {
            name: "docker-compose.yml",
            digest: digest(localAssets["docker-compose.yml"]),
          },
          {
            name: "release-manifest.json",
            digest: digest(localAssets["release-manifest.json"]),
          },
        ],
        uploadAsset,
        refreshRelease,
        assetRoot: () => repositoryRoot,
      }),
    ).resolves.toBe(refreshed);

    expect(uploaded).toEqual(["example.env", "SHA256SUMS"]);
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(refreshRelease).toHaveBeenCalledOnce();
    expect(refreshRelease).toHaveBeenCalledWith(context.repository, release.id);
  });

  it("keeps HTTP upload failures fail-closed with useful diagnostics", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          '{"message":"validation failed"}\nunsafe' +
            String.fromCharCode(0) +
            "text",
          {
            status: 422,
            statusText: "Unprocessable Content",
          },
        ),
    );

    await expect(
      uploadReleaseAsset({
        release,
        name: "example.env",
        filePath: "unused",
        token: "token",
        fetchImpl,
        readAsset: async () => Buffer.from("content"),
      }),
    ).rejects.toThrow(
      'Uploading release asset example.env failed: HTTP 422 {"message":"validation failed"} unsafe text',
    );
  });

  it("wraps network failures with sanitized asset context", async () => {
    const token = "secret-token";
    await expect(
      uploadReleaseAsset({
        release,
        name: "example.env",
        filePath: "unused",
        token,
        fetchImpl: async () => {
          throw new Error(`socket${String.fromCharCode(0)} failed ${token}`);
        },
        readAsset: async () => Buffer.from("content"),
      }),
    ).rejects.toThrow(
      "Uploading release asset example.env failed during network request: socket  failed [redacted]",
    );
  });

  it("wraps response body read failures with asset context", async () => {
    const response = {
      status: 502,
      text: async () => {
        throw new Error("body stream aborted");
      },
    } as unknown as Response;

    await expect(
      uploadReleaseAsset({
        release,
        name: "SHA256SUMS",
        filePath: "unused",
        token: "token",
        fetchImpl: async () => response,
        readAsset: async () => Buffer.from("content"),
      }),
    ).rejects.toThrow(
      "Uploading release asset SHA256SUMS failed during response body read: body stream aborted",
    );
  });

  it("verifies remote assets after successful missing-asset upload", async () => {
    const events: string[] = [];
    const refreshed = { ...release };

    await expect(
      reconcileReleaseAssets({
        context,
        release,
        provenance: complete,
        complete,
        localAssets,
        uploadOptions: {
          observeAssets: async () => {
            events.push("inspect");
            return Object.entries(localAssets)
              .filter(([name]) => name !== "example.env")
              .map(([name, content]) => ({ name, digest: digest(content) }));
          },
          uploadAsset: async ({ name }: { name: string }) => {
            events.push(`upload:${name}`);
          },
          refreshRelease: () => {
            events.push("refresh");
            return refreshed;
          },
          assetRoot: () => repositoryRoot,
        },
        verifyAssets: async ({ release: verifiedRelease }) => {
          expect(verifiedRelease).toBe(refreshed);
          events.push("verify");
        },
      }),
    ).resolves.toBe(refreshed);

    expect(events).toEqual([
      "inspect",
      "upload:example.env",
      "refresh",
      "verify",
    ]);
  });

  it("resumes safely when every asset already exists on an unpublished draft", async () => {
    const uploadAsset = vi.fn();
    const refreshRelease = vi.fn(() => ({ ...release }));
    const verifyAssets = vi.fn();

    await expect(
      reconcileReleaseAssets({
        context,
        release,
        provenance: complete,
        complete,
        localAssets,
        uploadOptions: {
          observeAssets: async () =>
            Object.entries(localAssets).map(([name, content]) => ({
              name,
              digest: digest(content),
            })),
          uploadAsset,
          refreshRelease,
        },
        verifyAssets,
      }),
    ).resolves.toEqual(release);

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(refreshRelease).toHaveBeenCalledOnce();
    expect(refreshRelease).toHaveBeenCalledWith(context.repository, release.id);
    expect(verifyAssets).toHaveBeenCalledOnce();
    expect(verifyAssets).toHaveBeenCalledWith({
      context,
      release: expect.objectContaining({ id: release.id, draft: true }),
      localAssets,
    });
  });

  it("blocks conflicting assets before upload, refresh, or verification", async () => {
    const uploadAsset = vi.fn();
    const refreshRelease = vi.fn();
    const verifyAssets = vi.fn();

    await expect(
      reconcileReleaseAssets({
        context,
        release,
        provenance: complete,
        complete,
        localAssets,
        uploadOptions: {
          observeAssets: async () => [
            {
              name: "docker-compose.yml",
              digest: `sha256:${"f".repeat(64)}`,
            },
          ],
          uploadAsset,
          refreshRelease,
        },
        verifyAssets,
      }),
    ).rejects.toThrow("Draft assets conflict");

    expect(uploadAsset).not.toHaveBeenCalled();
    expect(refreshRelease).not.toHaveBeenCalled();
    expect(verifyAssets).not.toHaveBeenCalled();
  });
});
