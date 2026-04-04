import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const getRequestSession = vi.fn();
const findFileById = vi.fn();
const recordFileAccessBestEffort = vi.fn();
const getStoragePath = vi.fn();

vi.mock("@/server/auth/guards", () => ({
  getRequestSession,
}));

vi.mock("@/server/library/repository", () => ({
  prismaLibraryRepository: {
    findFileById,
  },
}));

vi.mock("@/server/retrieval/recent-tracking", () => ({
  recordFileAccessBestEffort,
}));

vi.mock("@/server/storage", () => ({
  getStoragePath,
}));

const makeFile = (
  overrides: Partial<{
    id: string;
    ownerUserId: string;
    deletedAt: Date | null;
    storageKey: string;
  }> = {},
) => ({
  id: "file-1",
  ownerUserId: "alice",
  ownerUsername: "alice",
  folderId: null,
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 11,
  deletedAt: null,
  createdAt: new Date("2026-04-02T12:00:00.000Z"),
  updatedAt: new Date("2026-04-02T12:00:00.000Z"),
  storageKey: "library/alice/notes.txt",
  contentChecksum: null,
  previewStatus: "pending",
  ...overrides,
});

describe("private file download route", () => {
  let tempDir = "";
  let tempFilePath = "";

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "staaash-download-test-"));
    tempFilePath = path.join(tempDir, "notes.txt");
    await writeFile(tempFilePath, "hello world", "utf8");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, {
        recursive: true,
        force: true,
      });
    }
  });

  it("requires authentication", async () => {
    const { GET } =
      await import("@/app/api/library/files/[fileId]/download/route");
    getRequestSession.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest("http://localhost/api/library/files/file-1/download"),
      {
        params: Promise.resolve({
          fileId: "file-1",
        }),
      },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "/sign-in?next=%2Fapi%2Flibrary%2Ffiles%2Ffile-1%2Fdownload",
    );
    expect(recordFileAccessBestEffort).not.toHaveBeenCalled();
  });

  it("denies unauthorized access without recording recents", async () => {
    const { GET } =
      await import("@/app/api/library/files/[fileId]/download/route");
    getRequestSession.mockResolvedValueOnce({
      user: {
        id: "bob",
        role: "member",
      },
    });
    findFileById.mockResolvedValueOnce(makeFile({ ownerUserId: "alice" }));

    const response = await GET(
      new NextRequest("http://localhost/api/library/files/file-1/download"),
      {
        params: Promise.resolve({
          fileId: "file-1",
        }),
      },
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toBe(
      "You do not have access to that folder.",
    );
    expect(recordFileAccessBestEffort).not.toHaveBeenCalled();
  });

  it("returns attachment headers and records access after authorization", async () => {
    const { GET } =
      await import("@/app/api/library/files/[fileId]/download/route");
    getRequestSession.mockResolvedValueOnce({
      user: {
        id: "alice",
        role: "member",
      },
    });
    findFileById.mockResolvedValueOnce(makeFile());
    getStoragePath.mockReturnValueOnce(tempFilePath);
    recordFileAccessBestEffort.mockResolvedValueOnce(undefined);

    const response = await GET(
      new NextRequest("http://localhost/api/library/files/file-1/download"),
      {
        params: Promise.resolve({
          fileId: "file-1",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''notes.txt",
    );
    expect(response.headers.get("content-type")).toBe("text/plain");
    expect(response.headers.get("content-length")).toBe("11");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toBe("hello world");
    expect(recordFileAccessBestEffort).toHaveBeenCalledWith({
      actorUserId: "alice",
      actorRole: "member",
      fileId: "file-1",
      source: "download-file-route",
    });
  });

  it("returns success even if best-effort recent logging resolves (helper absorbs errors internally)", async () => {
    const { GET } =
      await import("@/app/api/library/files/[fileId]/download/route");
    getRequestSession.mockResolvedValueOnce({
      user: { id: "alice", role: "member" },
    });
    findFileById.mockResolvedValueOnce(makeFile());
    getStoragePath.mockReturnValueOnce(tempFilePath);
    recordFileAccessBestEffort.mockResolvedValueOnce(undefined);

    const response = await GET(
      new NextRequest("http://localhost/api/library/files/file-1/download"),
      {
        params: Promise.resolve({ fileId: "file-1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello world");
  });

  it("does not record a recent row when the storage object cannot be opened", async () => {
    const { GET } =
      await import("@/app/api/library/files/[fileId]/download/route");
    getRequestSession.mockResolvedValueOnce({
      user: { id: "alice", role: "member" },
    });
    findFileById.mockResolvedValueOnce(makeFile());
    // Return a path that definitely does not exist.
    getStoragePath.mockReturnValueOnce(
      path.join(os.tmpdir(), "staaash-nonexistent-file-xyz.txt"),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/library/files/file-1/download"),
      {
        params: Promise.resolve({ fileId: "file-1" }),
      },
    );

    expect(response.status).toBe(404);
    expect(recordFileAccessBestEffort).not.toHaveBeenCalled();
  });
});
