import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const getRequestSession = vi.fn();
const findZipArchiveById = vi.fn();

vi.mock("@/server/auth/guards", () => ({
  getRequestSession,
}));

vi.mock("@staaash/db/zip-archives", () => ({
  findZipArchiveById,
}));

const makeArchive = (overrides: Record<string, unknown> = {}) => ({
  id: "archive-1",
  userId: "alice",
  contentKey: "content-key",
  idsJson: { fileIds: ["file-1"], folderIds: [] },
  status: "processing",
  storageKey: null,
  fileName: null,
  sizeBytes: null,
  fileCount: 2,
  error: null,
  expiresAt: new Date("2026-09-10T12:00:00.000Z"),
  createdAt: new Date("2026-09-09T12:00:00.000Z"),
  updatedAt: new Date("2026-09-09T12:00:00.000Z"),
  storageRevision: 0,
  ...overrides,
});

const request = () =>
  new NextRequest("http://localhost/api/files/archives/archive-1", {
    headers: { Accept: "application/json" },
  });

const callRoute = async () => {
  const { GET } = await import("@/app/api/files/archives/[archiveId]/route");

  return GET(request(), {
    params: Promise.resolve({ archiveId: "archive-1" }),
  });
};

describe("archive status route", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication", async () => {
    getRequestSession.mockResolvedValueOnce(null);

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(findZipArchiveById).not.toHaveBeenCalled();
  });

  it("returns the existing status payload to the archive owner", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "alice", role: "member" },
    });
    findZipArchiveById.mockResolvedValueOnce(
      makeArchive({
        status: "ready",
        sizeBytes: 1234n,
      }),
    );

    const response = await callRoute();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      fileCount: 2,
      sizeBytes: "1234",
      error: null,
    });
  });

  it("denies another member without returning archive metadata", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "bob", role: "member" },
    });
    findZipArchiveById.mockResolvedValueOnce(
      makeArchive({
        status: "ready",
        sizeBytes: 1234n,
        fileCount: 99,
        error: "private error",
      }),
    );

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "You do not have access to that folder.",
      code: "ACCESS_DENIED",
    });
  });

  it("denies the owner role from browsing a member archive", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "owner", role: "owner" },
    });
    findZipArchiveById.mockResolvedValueOnce(makeArchive());

    const response = await callRoute();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "ACCESS_DENIED",
    });
  });

  it("preserves the existing not-found response", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "alice", role: "member" },
    });
    findZipArchiveById.mockResolvedValueOnce(null);

    const response = await callRoute();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "That file does not exist.",
      code: "FILE_NOT_FOUND",
    });
  });
});
