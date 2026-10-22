import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { getRequestSession, findZipArchiveById, assertStorageEntityReadable } =
  vi.hoisted(() => ({
    getRequestSession: vi.fn(),
    findZipArchiveById: vi.fn(),
    assertStorageEntityReadable: vi.fn(),
  }));

vi.mock("@/server/auth/guards", () => ({
  getRequestSession,
}));

vi.mock("@staaash/db/zip-archives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/zip-archives")>()),
  findZipArchiveById,
}));

vi.mock("@/server/storage-read-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/storage-read-guard")>()),
  assertStorageEntityReadable,
}));

import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

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

describe("archive routes", () => {
  afterEach(() => {
    vi.resetAllMocks();
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

  it("keeps a published archive processing until its journal permits reads", async () => {
    getRequestSession.mockResolvedValue({
      user: { id: "alice", role: "member" },
    });
    findZipArchiveById.mockResolvedValue(makeArchive({ status: "ready" }));
    assertStorageEntityReadable.mockRejectedValueOnce(
      new StorageEntityUnavailableError({
        id: "publication",
        kind: "archive_publish",
        status: "finalizing",
      }),
    );

    const blocked = await callRoute();
    expect(blocked.status).toBe(200);
    expect(await blocked.json()).toMatchObject({ status: "processing" });
    const ready = await callRoute();
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ status: "ready" });
  });

  it("reports recovery-required archives as unavailable", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "alice", role: "member" },
    });
    findZipArchiveById.mockResolvedValueOnce(makeArchive({ status: "ready" }));
    assertStorageEntityReadable.mockRejectedValueOnce(
      new StorageEntityUnavailableError({
        id: "publication",
        kind: "archive_publish",
        status: "recovery_required",
      }),
    );

    const response = await callRoute();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "STORAGE_RECOVERY_REQUIRED",
    });
  });

  it("returns a structured 503 if publication blocks an immediate download", async () => {
    getRequestSession.mockResolvedValueOnce({
      user: { id: "alice", role: "member" },
    });
    findZipArchiveById.mockResolvedValueOnce(
      makeArchive({ status: "ready", storageKey: "archives/archive-1.zip" }),
    );
    assertStorageEntityReadable.mockRejectedValueOnce(
      new StorageEntityUnavailableError({
        id: "publication",
        kind: "archive_publish",
        status: "finalizing",
      }),
    );
    const { GET } =
      await import("@/app/api/files/archives/[archiveId]/download/route");
    const response = await GET(request(), {
      params: Promise.resolve({ archiveId: "archive-1" }),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Storage-Mutation-Id")).toBe("publication");
    expect(await response.json()).toMatchObject({
      code: "STORAGE_MUTATION_RECOVERING",
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
