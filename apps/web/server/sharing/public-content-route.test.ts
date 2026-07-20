import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { ShareError, type ShareErrorCode } from "@/server/sharing/errors";

const PUBLIC_SHARE_CONTENT_SECURITY_POLICY =
  "sandbox; default-src 'none'; form-action 'none'; base-uri 'none'";

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  getSharedFileContent: vi.fn(),
  getSharedNestedFileContent: vi.fn(),
  resolvePublicShare: vi.fn(),
  getStoragePath: vi.fn(),
  markFileStorageMissing: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet })),
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    getSharedFileContent: mocks.getSharedFileContent,
    getSharedNestedFileContent: mocks.getSharedNestedFileContent,
    resolvePublicShare: mocks.resolvePublicShare,
  },
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

const makeFile = (
  overrides: Partial<StoredFile> & Pick<StoredFile, "mimeType" | "name">,
): StoredFile => ({
  id: "file-1",
  ownerUserId: "member-1",
  ownerStorageId: "member-1",
  folderId: "folder-1",
  sizeBytes: 0,
  viewerKind: null,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  storageKey: "fixture",
  storageStatus: "available",
  storageCheckedAt: null,
  storageMissingAt: null,
  contentChecksum: null,
  ...overrides,
});

const expectPublicSecurityHeaders = (
  response: Response,
  {
    disposition,
    contentType,
  }: { disposition: "attachment" | "inline"; contentType: string },
) => {
  expect(response.headers.get("content-disposition")).toMatch(
    new RegExp(`^${disposition};`, "u"),
  );
  expect(response.headers.get("content-type")).toBe(contentType);
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe(
    PUBLIC_SHARE_CONTENT_SECURITY_POLICY,
  );
};

const expectDownloadDisabledResponse = async (response: Response) => {
  expect(response.status).toBe(403);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(await response.text()).toBe(
    "Downloads are disabled for this shared link.",
  );
};

describe("public share content routes", () => {
  let tempDir = "";
  const paths = new Map<string, string>();

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "staaash-public-content-"));
    const fixtures = {
      html: "<!doctype html><script>window.executed = true</script>",
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><script /></svg>',
      png: "safe-png-bytes",
      audio: "0123456789",
      unknown: "unknown-bytes",
    };

    for (const [storageKey, bytes] of Object.entries(fixtures)) {
      const fixturePath = path.join(tempDir, storageKey);
      await writeFile(fixturePath, bytes, "utf8");
      paths.set(storageKey, fixturePath);
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue(null);
    mocks.resolvePublicShare.mockResolvedValue({
      share: { downloadDisabled: false },
    });
    mocks.getStoragePath.mockImplementation((storageKey: string) =>
      paths.get(storageKey),
    );
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("forces top-level shared HTML to attachment while preserving bytes", async () => {
    const file = makeFile({
      mimeType: "text/html",
      name: "payload.html",
      storageKey: "html",
      viewerKind: "text",
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    const { GET } = await import("@/app/s/[token]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/content"),
      {
        params: Promise.resolve({ token: "token" }),
      },
    );

    expect(response.status).toBe(200);
    expectPublicSecurityHeaders(response, {
      disposition: "attachment",
      contentType: "application/octet-stream",
    });
    expect(await response.text()).toBe(
      "<!doctype html><script>window.executed = true</script>",
    );
  });

  it("applies the same policy to nested shared SVG", async () => {
    const file = makeFile({
      id: "svg-1",
      mimeType: "image/svg+xml",
      name: "payload.svg",
      storageKey: "svg",
      viewerKind: "image",
    });
    mocks.getSharedNestedFileContent.mockResolvedValue({ file });
    const { GET } =
      await import("@/app/s/[token]/files/[fileId]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/files/svg-1/content"),
      { params: Promise.resolve({ token: "token", fileId: "svg-1" }) },
    );

    expect(response.status).toBe(200);
    expectPublicSecurityHeaders(response, {
      disposition: "attachment",
      contentType: "application/octet-stream",
    });
    expect(await response.text()).toContain("<svg");
  });

  it("keeps public security headers on partial active content", async () => {
    const file = makeFile({
      mimeType: "TeXt/HtMl; charset=UTF-8",
      name: "payload.html",
      storageKey: "html",
      viewerKind: "text",
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    const { GET } = await import("@/app/s/[token]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/content", {
        headers: { range: "bytes=0-8" },
      }),
      { params: Promise.resolve({ token: "token" }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-8/54");
    expect(response.headers.get("content-length")).toBe("9");
    expectPublicSecurityHeaders(response, {
      disposition: "attachment",
      contentType: "application/octet-stream",
    });
    expect(await response.text()).toBe("<!doctype");
  });

  it("fails an unknown non-viewable MIME closed to attachment", async () => {
    const file = makeFile({
      mimeType: "application/x-unknown",
      name: "unknown.bin",
      storageKey: "unknown",
      viewerKind: null,
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    const { GET } = await import("@/app/s/[token]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/content"),
      {
        params: Promise.resolve({ token: "token" }),
      },
    );

    expect(response.status).toBe(200);
    expectPublicSecurityHeaders(response, {
      disposition: "attachment",
      contentType: "application/octet-stream",
    });
    expect(await response.text()).toBe("unknown-bytes");
  });

  it("blocks top-level unknown attachment bytes when downloads are disabled", async () => {
    const file = makeFile({
      mimeType: "application/x-unknown",
      name: "unknown.bin",
      storageKey: "unknown",
      viewerKind: null,
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    mocks.resolvePublicShare.mockResolvedValue({
      share: { downloadDisabled: true },
    });
    const { GET } = await import("@/app/s/[token]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/content"),
      { params: Promise.resolve({ token: "token" }) },
    );

    await expectDownloadDisabledResponse(response);
  });

  it("blocks top-level active HTML bytes when downloads are disabled", async () => {
    const file = makeFile({
      mimeType: "text/html",
      name: "payload.html",
      storageKey: "html",
      viewerKind: "text",
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    mocks.resolvePublicShare.mockResolvedValue({
      share: { downloadDisabled: true },
    });
    const { GET } = await import("@/app/s/[token]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/content"),
      { params: Promise.resolve({ token: "token" }) },
    );

    await expectDownloadDisabledResponse(response);
  });

  it("blocks nested active SVG bytes when downloads are disabled", async () => {
    const file = makeFile({
      id: "svg-1",
      mimeType: "image/svg+xml",
      name: "payload.svg",
      storageKey: "svg",
      viewerKind: "image",
    });
    mocks.getSharedNestedFileContent.mockResolvedValue({ file });
    mocks.resolvePublicShare.mockResolvedValue({
      share: { downloadDisabled: true },
    });
    const { GET } =
      await import("@/app/s/[token]/files/[fileId]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/files/svg-1/content"),
      { params: Promise.resolve({ token: "token", fileId: "svg-1" }) },
    );

    await expectDownloadDisabledResponse(response);
  });

  it.each(["", "image/png; charset", "image/png\r\ntext/html"])(
    "fails empty or malformed route MIME %j closed without emitting it",
    async (mimeType) => {
      const file = makeFile({
        mimeType,
        name: "malformed.bin",
        storageKey: "unknown",
        viewerKind: null,
      });
      mocks.getSharedFileContent.mockResolvedValue({ file });
      const { GET } = await import("@/app/s/[token]/content/route");

      const response = await GET(
        new Request("http://localhost/s/token/content"),
        { params: Promise.resolve({ token: "token" }) },
      );

      expect(response.status).toBe(200);
      expectPublicSecurityHeaders(response, {
        disposition: "attachment",
        contentType: "application/octet-stream",
      });
      expect(await response.text()).toBe("unknown-bytes");
    },
  );

  it("keeps an allowlisted raster image inline", async () => {
    const file = makeFile({
      mimeType: "image/png; charset=binary",
      name: "safe.png",
      storageKey: "png",
      viewerKind: "image",
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    mocks.resolvePublicShare.mockResolvedValue({
      share: { downloadDisabled: true },
    });
    const { GET } = await import("@/app/s/[token]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/content"),
      {
        params: Promise.resolve({ token: "token" }),
      },
    );

    expect(response.status).toBe(200);
    expectPublicSecurityHeaders(response, {
      disposition: "inline",
      contentType: "image/png",
    });
    expect(await response.text()).toBe("safe-png-bytes");
  });

  it("keeps allowlisted audio inline with byte-range behavior", async () => {
    const file = makeFile({
      id: "audio-1",
      mimeType: "audio/mpeg",
      name: "safe.mp3",
      storageKey: "audio",
      viewerKind: "audio",
    });
    mocks.getSharedNestedFileContent.mockResolvedValue({ file });
    mocks.resolvePublicShare.mockResolvedValue({
      share: { downloadDisabled: true },
    });
    const { GET } =
      await import("@/app/s/[token]/files/[fileId]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/files/audio-1/content", {
        headers: { range: "bytes=2-5" },
      }),
      { params: Promise.resolve({ token: "token", fileId: "audio-1" }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10");
    expectPublicSecurityHeaders(response, {
      disposition: "inline",
      contentType: "audio/mpeg",
    });
    expect(await response.text()).toBe("2345");
  });

  it("redirects active public previews only to the fail-closed content route", async () => {
    const file = makeFile({
      mimeType: "text/html",
      name: "payload.html",
      storageKey: "html",
      viewerKind: "text",
    });
    mocks.getSharedFileContent.mockResolvedValue({ file });
    const { GET } = await import("@/app/s/[token]/preview/route");

    const response = await GET(
      new Request("http://localhost/s/token/preview"),
      {
        params: Promise.resolve({ token: "token" }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/s/token/content",
    );
    expect(await response.text()).toBe("");
  });

  it("redirects nested active previews only to the nested fail-closed route", async () => {
    const file = makeFile({
      id: "svg-1",
      mimeType: "image/svg+xml",
      name: "payload.svg",
      storageKey: "svg",
      viewerKind: "image",
    });
    mocks.getSharedNestedFileContent.mockResolvedValue({ file });
    const { GET } =
      await import("@/app/s/[token]/files/[fileId]/preview/route");

    const response = await GET(
      new Request("http://localhost/s/token/files/svg-1/preview"),
      { params: Promise.resolve({ token: "token", fileId: "svg-1" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/s/token/files/svg-1/content",
    );
    expect(await response.text()).toBe("");
  });

  it.each([
    ["SHARE_PASSWORD_REQUIRED", 401],
    ["SHARE_EXPIRED", 410],
    ["SHARE_INVALID", 404],
  ] satisfies Array<[ShareErrorCode, number]>)(
    "preserves top-level %s resolution errors",
    async (code, status) => {
      mocks.getSharedFileContent.mockRejectedValue(new ShareError(code));
      const { GET } = await import("@/app/s/[token]/content/route");

      const response = await GET(
        new Request("http://localhost/s/token/content"),
        { params: Promise.resolve({ token: "token" }) },
      );

      expect(response.status).toBe(status);
      expect(await response.text()).toBe(new ShareError(code).message);
      expect(mocks.getStoragePath).not.toHaveBeenCalled();
    },
  );

  it("preserves nested containment rejection", async () => {
    mocks.getSharedNestedFileContent.mockRejectedValue(
      new ShareError("SHARE_ACCESS_DENIED"),
    );
    const { GET } =
      await import("@/app/s/[token]/files/[fileId]/content/route");

    const response = await GET(
      new Request("http://localhost/s/token/files/outside/content"),
      {
        params: Promise.resolve({ token: "token", fileId: "outside" }),
      },
    );

    expect(response.status).toBe(403);
    expect(await response.text()).toBe(
      "That shared item is not available from this location.",
    );
    expect(mocks.getStoragePath).not.toHaveBeenCalled();
  });
});
