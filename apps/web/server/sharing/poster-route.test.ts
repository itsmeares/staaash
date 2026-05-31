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

const mocks = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  findReadyPosterDerivative: vi.fn(),
  getSharedNestedFileContent: vi.fn(),
  getStoragePath: vi.fn(),
  resolvePublicShare: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: mocks.cookieGet,
  })),
}));

vi.mock("@staaash/db/media-derivatives", () => ({
  findReadyPosterDerivative: mocks.findReadyPosterDerivative,
}));

vi.mock("@/server/storage", () => ({
  getStoragePath: mocks.getStoragePath,
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    getSharedNestedFileContent: mocks.getSharedNestedFileContent,
    resolvePublicShare: mocks.resolvePublicShare,
  },
}));

const fixedNow = new Date("2026-05-31T12:00:00.000Z");

const makeFile = () => ({
  id: "file-1",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  folderId: "folder-1",
  name: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 1024,
  viewerKind: "video",
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
});

const makeResolution = (overrides: object = {}) => ({
  kind: "file",
  share: {
    id: "share-1",
    hasPassword: false,
    status: "active",
  },
  access: {
    requiresPassword: false,
    isUnlocked: true,
  },
  file: makeFile(),
  ...overrides,
});

describe("public share poster route", () => {
  let tempDir = "";
  let posterPath = "";

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "staaash-poster-route-"));
    posterPath = path.join(tempDir, "poster.jpg");
    await writeFile(posterPath, "poster-bytes", "utf8");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookieGet.mockReturnValue(null);
    mocks.getStoragePath.mockReturnValue(posterPath);
    mocks.resolvePublicShare.mockResolvedValue(makeResolution());
    mocks.findReadyPosterDerivative.mockResolvedValue({
      storageKey: "derivatives/user-1/file-1/social-poster.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12n,
    });
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns a ready poster for active public video shares", async () => {
    const { GET } = await import("@/app/s/[token]/poster/route");

    const response = await GET(new Request("http://localhost/s/token/poster"), {
      params: Promise.resolve({ token: "token" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe("12");
    expect(await response.text()).toBe("poster-bytes");
  });

  it("returns a ready poster for nested files in folder shares", async () => {
    const { GET } = await import("@/app/s/[token]/files/[fileId]/poster/route");
    mocks.resolvePublicShare.mockResolvedValue(
      makeResolution({
        kind: "folder",
        listing: {
          rootFolder: { id: "folder-1", ownerUserId: "user-1" },
        },
      }),
    );
    mocks.getSharedNestedFileContent.mockResolvedValue({ file: makeFile() });

    const response = await GET(
      new Request("http://localhost/s/token/files/file-1/poster"),
      {
        params: Promise.resolve({ token: "token", fileId: "file-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(mocks.getSharedNestedFileContent).toHaveBeenCalledWith({
      token: "token",
      fileId: "file-1",
      shareAccessCookieValue: null,
    });
  });

  it("returns 404 when the poster is not ready", async () => {
    const { GET } = await import("@/app/s/[token]/poster/route");
    mocks.findReadyPosterDerivative.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost/s/token/poster"), {
      params: Promise.resolve({ token: "token" }),
    });

    expect(response.status).toBe(404);
  });

  it("returns 404 for passworded shares", async () => {
    const { GET } = await import("@/app/s/[token]/poster/route");
    mocks.resolvePublicShare.mockResolvedValue(
      makeResolution({
        share: {
          id: "share-1",
          hasPassword: true,
          status: "active",
        },
      }),
    );

    const response = await GET(new Request("http://localhost/s/token/poster"), {
      params: Promise.resolve({ token: "token" }),
    });

    expect(response.status).toBe(404);
    expect(mocks.findReadyPosterDerivative).not.toHaveBeenCalled();
  });
});
