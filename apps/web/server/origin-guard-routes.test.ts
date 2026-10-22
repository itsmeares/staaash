import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { app } from "@/server/http/app";

import { getRequestSession } from "@/server/auth/guards";
import { scheduleZipArchiveGenerate } from "@staaash/db/jobs";
import { createResumableSession } from "@/server/uploads/session-service";
import { UploadAdmissionError } from "@/server/uploads/admission";

vi.mock("@/server/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/guards")>()),
  getRequestSession: vi.fn(),
}));

vi.mock("@/server/durable-storage-mutation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/durable-storage-mutation")
  >()),
  assertStorageProtocolReady: vi.fn(async () => undefined),
  StorageProtocolNotReadyError: class extends Error {
    code = "STORAGE_MUTATION_RECOVERING";
    status = 503;
  },
}));

vi.mock("@/server/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/uploads")>()),
  UploadError: class UploadError extends Error {
    code = "UPLOAD_ERROR";
    status = 400;
  },
  assertUploadSizeAllowed: vi.fn(),
  computeFileSha256: vi.fn(),
}));

vi.mock("@/server/uploads/session-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/uploads/session-service")
  >()),
  createResumableSession: vi.fn(),
  findActiveResumableSession: vi.fn(),
  updateSessionProgress: vi.fn(),
}));

vi.mock("@/server/files/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/service")>()),
  filesService: {
    commitResumableUpload: vi.fn(),
  },
}));

vi.mock("@/server/files/errors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/errors")>()),
  FilesError: class FilesError extends Error {
    code = "FILES_ERROR";
    status = 400;
  },
}));

vi.mock("@/server/files/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/repository")>()),
  prismaFilesRepository: {
    findFileById: vi.fn(),
    findFolderById: vi.fn(),
  },
}));

vi.mock("@/server/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/settings")>()),
  getSystemSettings: vi.fn(),
}));

vi.mock("@staaash/db/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/jobs")>()),
  scheduleZipArchiveGenerate: vi.fn(),
}));

vi.mock("@staaash/db/zip-archives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/zip-archives")>()),
  ZIP_ARCHIVE_STATUS_FAILED: "failed",
  ZIP_ARCHIVE_STATUS_READY: "ready",
  buildZipContentKey: vi.fn(),
  findOrCreateZipArchive: vi.fn(),
}));

const crossOriginRequest = (path: string, method: string) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      accept: "application/json",
      host: "localhost:3000",
      origin: "https://evil.example",
    },
  });

const sameOriginJsonRequest = (path: string, method: string, body: unknown) =>
  new Request(`http://localhost:3000${path}`, {
    method,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body: JSON.stringify(body),
  });

const expectCrossOriginRejection = async (response: Response) => {
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toMatchObject({
    error: "Cross-origin requests are not allowed.",
  });
  expect(getRequestSession).not.toHaveBeenCalled();
};

describe("mutating route same-origin guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cross-origin upload session creation before auth or storage work", async () => {
    const response = await app.request(
      crossOriginRequest("/api/uploads/sessions", "POST"),
    );

    await expectCrossOriginRejection(response);
    expect(createResumableSession).not.toHaveBeenCalled();
  });

  it("rejects cross-origin upload session patching before auth", async () => {
    const response = await app.request(
      crossOriginRequest("/api/uploads/sessions/upload-1", "PATCH"),
    );

    await expectCrossOriginRejection(response);
  });

  it("rejects cross-origin upload session cancellation before auth", async () => {
    const response = await app.request(
      crossOriginRequest("/api/uploads/sessions/upload-1", "DELETE"),
    );

    await expectCrossOriginRejection(response);
  });

  it("rejects cross-origin upload completion before auth", async () => {
    const response = await app.request(
      crossOriginRequest("/api/uploads/sessions/upload-1/complete", "POST"),
    );

    await expectCrossOriginRejection(response);
  });

  it("rejects cross-origin archive creation before auth or job scheduling", async () => {
    const response = await app.request(
      crossOriginRequest("/api/files/archives", "POST"),
    );

    await expectCrossOriginRejection(response);
    expect(scheduleZipArchiveGenerate).not.toHaveBeenCalled();
  });
});

describe("upload session creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRequestSession).mockResolvedValue({
      user: { id: "user-1", role: "owner" },
    } as Awaited<ReturnType<typeof getRequestSession>>);
    vi.mocked(createResumableSession).mockResolvedValue({
      id: "session-1",
      ownerUserId: "user-1",
      folderId: null,
      originalName: "video.mp4",
      mimeType: "video/mp4",
      totalSizeBytes: 123,
      receivedBytes: 0,
      expectedChecksum:
        "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      protocolVersion: 2,
      chunkSizeBytes: 10 * 1024 * 1024,
      completedChunks: [],
      tmpPath: "/tmp/session-1",
      conflictStrategy: "safeRename",
      status: "created",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("passes expected checksum into resumable session creation", async () => {
    const expectedChecksum =
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";

    const response = await app.request(
      sameOriginJsonRequest("/api/uploads/sessions", "POST", {
        folderId: null,
        originalName: "video.mp4",
        mimeType: "video/mp4",
        totalSizeBytes: 123,
        conflictStrategy: "safeRename",
        expectedChecksum,
      }),
    );

    expect(response.status).toBe(201);
    expect(createResumableSession).toHaveBeenCalledWith({
      ownerUserId: "user-1",
      folderId: null,
      originalName: "video.mp4",
      mimeType: "video/mp4",
      totalSizeBytes: 123,
      expectedChecksum,
      conflictStrategy: "safeRename",
    });
  });

  it("rejects malformed expected checksums", async () => {
    const response = await app.request(
      sameOriginJsonRequest("/api/uploads/sessions", "POST", {
        folderId: null,
        originalName: "video.mp4",
        mimeType: "video/mp4",
        totalSizeBytes: 123,
        expectedChecksum: "not-a-sha256",
      }),
    );

    expect(response.status).toBe(400);
    expect(createResumableSession).not.toHaveBeenCalled();
  });

  it("returns stable admission error codes and status", async () => {
    vi.mocked(createResumableSession).mockRejectedValue(
      new UploadAdmissionError("RESUMABLE_INSTANCE_SESSION_LIMIT_EXCEEDED"),
    );

    const response = await app.request(
      sameOriginJsonRequest("/api/uploads/sessions", "POST", {
        folderId: null,
        originalName: "video.mp4",
        mimeType: "video/mp4",
        totalSizeBytes: 123,
        expectedChecksum: null,
      }),
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: "RESUMABLE_INSTANCE_SESSION_LIMIT_EXCEEDED",
    });
  });
});
