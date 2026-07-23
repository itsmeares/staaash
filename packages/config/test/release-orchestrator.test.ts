import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  reconcileReleaseAssets,
  releaseAssetUploadUrl,
  uploadMissingDraftAssets,
  uploadReleaseAsset,
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
  release: { tag: "v1.0.0-rc.7" },
};

const release = {
  id: 42,
  draft: true,
  upload_url:
    "https://uploads.github.com/repos/itsmeares/staaash/releases/42/assets{?name,label}",
};

const complete = {
  tag: "v1.0.0-rc.7",
  commit: "1".repeat(40),
  tagObject: "2".repeat(40),
  imageDigest: `sha256:${"a".repeat(64)}`,
  immutableImage: `ghcr.io/itsmeares/staaash:v1.0.0-rc.7@sha256:${"a".repeat(64)}`,
  assetChecksums: {},
};

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
    const refreshed = { ...release, body: "refreshed" };
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
      }),
    ).resolves.toBe(refreshed);

    expect(uploaded).toEqual(["example.env", "SHA256SUMS"]);
    expect(uploadAsset).toHaveBeenCalledTimes(2);
    expect(refreshRelease).toHaveBeenCalledOnce();
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

  it("verifies remote assets after successful missing-asset upload", async () => {
    const events: string[] = [];
    const refreshed = { ...release, body: "refreshed" };

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
