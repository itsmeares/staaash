import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { StoredFile } from "@/server/files/types";

const PUBLIC_SHARE_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; form-action 'none'; base-uri 'none'";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  getStoragePath: vi.fn(),
  markFileStorageMissing: vi.fn(),
  scheduleDerivativeGenerate: vi.fn(),
  touchDerivativeViewed: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    mediaDerivative: { findFirst: mocks.findFirst },
  }),
}));

vi.mock("@staaash/db/media-derivatives", () => ({
  DERIVATIVE_KIND_PREVIEW: "preview",
  DERIVATIVE_PROFILE_1080P: "preview-1080p",
  DERIVATIVE_STATUS_FAILED: "failed",
  DERIVATIVE_STATUS_PROCESSING: "processing",
  DERIVATIVE_STATUS_QUEUED: "queued",
  DERIVATIVE_STATUS_READY: "ready",
  DERIVATIVE_STATUS_STALE: "stale",
  scheduleDerivativeGenerate: mocks.scheduleDerivativeGenerate,
  touchDerivativeViewed: mocks.touchDerivativeViewed,
}));

vi.mock("@/server/settings", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/server/storage", () => ({
  getStoragePath: mocks.getStoragePath,
}));

vi.mock("@/server/files/repository", () => ({
  prismaFilesRepository: {
    markFileStorageMissing: mocks.markFileStorageMissing,
  },
}));

const fixedNow = new Date("2026-07-20T12:00:00.000Z");

const makeVideoFile = (overrides: Partial<StoredFile> = {}): StoredFile => ({
  id: "video-1",
  ownerUserId: "member-1",
  ownerStorageId: "member-1",
  folderId: "folder-1",
  name: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 16,
  viewerKind: "video",
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  storageKey: "original",
  storageStatus: "available",
  storageCheckedAt: null,
  storageMissingAt: null,
  contentChecksum: null,
  ...overrides,
});

describe("public derivative content responses", () => {
  let tempDir = "";
  const paths = new Map<string, string>();

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "staaash-derivative-"));
    const fixtures = {
      derivative: "0123456789",
      original: "<h1>fallback</h1>",
      unsafeDerivative: "<svg><script /></svg>",
    };
    for (const [storageKey, bytes] of Object.entries(fixtures)) {
      const fixturePath = path.join(tempDir, storageKey);
      await writeFile(fixturePath, bytes, "utf8");
      paths.set(storageKey, fixturePath);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.touchDerivativeViewed.mockResolvedValue(undefined);
    mocks.getStoragePath.mockImplementation((storageKey: string) =>
      paths.get(storageKey),
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uses emitted safe derivative MIME for 206 policy headers", async () => {
    const { createPublicReadyDerivativeContentResponse } =
      await import("./public-share-content-response");
    const response = await createPublicReadyDerivativeContentResponse({
      request: new Request("http://localhost/poster", {
        headers: { range: "bytes=2-5" },
      }),
      downloadDisabled: false,
      derivative: {
        storageKey: "derivative",
        sizeBytes: 10n,
        mimeType: "ViDeO/Mp4; codecs=avc1",
      },
      fileName: "generated.mp4",
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/u);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(response.headers.get("content-security-policy")).toBe(
      PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
    );
    expect(await response.text()).toBe("2345");
  });

  it("serves a ready MP4 preview inline for an unsafe original when downloads are disabled", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "derivative-1",
      status: "ready",
      storageKey: "derivative",
      sizeBytes: 10n,
      mimeType: "video/mp4",
    });
    const { createPublicShareContentResponse } =
      await import("./public-share-content-response");

    const response = await createPublicShareContentResponse({
      request: new Request("http://localhost/content"),
      downloadDisabled: true,
      file: makeVideoFile({
        name: "source.mov",
        mimeType: "video/quicktime",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("content-disposition")).toMatch(/^inline;/u);
    expect(response.headers.get("content-security-policy")).toBe(
      PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("0123456789");
  });

  it("fails a ready derivative with missing MIME closed", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "derivative-1",
      status: "ready",
      storageKey: "unsafeDerivative",
      sizeBytes: 21n,
      mimeType: null,
    });
    const { createPublicShareContentResponse } =
      await import("./public-share-content-response");

    const response = await createPublicShareContentResponse({
      request: new Request("http://localhost/content"),
      downloadDisabled: false,
      file: makeVideoFile(),
    });

    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment;/u,
    );
  });

  it("forces a non-allowlisted derivative MIME to attachment", async () => {
    const { createPublicReadyDerivativeContentResponse } =
      await import("./public-share-content-response");
    const response = await createPublicReadyDerivativeContentResponse({
      request: new Request("http://localhost/poster"),
      downloadDisabled: false,
      derivative: {
        storageKey: "unsafeDerivative",
        sizeBytes: 21n,
        mimeType: "image/svg+xml",
      },
      fileName: "generated.svg",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment;/u,
    );
    expect(response.headers.get("content-security-policy")).toBe(
      PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
    );
    expect(await response.text()).toBe("<svg><script /></svg>");
  });

  it("cancels an unsafe derivative blocked by download policy", async () => {
    const { createPublicReadyDerivativeContentResponse } =
      await import("./public-share-content-response");

    await expect(
      createPublicReadyDerivativeContentResponse({
        request: new Request("http://localhost/poster"),
        downloadDisabled: true,
        derivative: {
          storageKey: "unsafeDerivative",
          sizeBytes: 21n,
          mimeType: "image/svg+xml",
        },
        fileName: "generated.svg",
      }),
    ).rejects.toMatchObject({
      code: "SHARE_DOWNLOAD_DISABLED",
      status: 403,
    });

    const originalPath = paths.get("unsafeDerivative")!;
    const movedPath = `${originalPath}.moved`;
    await rename(originalPath, movedPath);
    await rename(movedPath, originalPath);
  });

  it("re-evaluates original MIME when derivative lookup falls back", async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ status: "processing" });
    const { createPublicShareContentResponse } =
      await import("./public-share-content-response");
    const response = await createPublicShareContentResponse({
      request: new Request("http://localhost/content"),
      downloadDisabled: false,
      file: makeVideoFile({
        name: "disguised.html",
        mimeType: "text/html; charset=UTF-8",
        sizeBytes: 17,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment;/u,
    );
    expect(response.headers.get("content-security-policy")).toBe(
      PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
    );
    expect(await response.text()).toBe("<h1>fallback</h1>");
  });
});
