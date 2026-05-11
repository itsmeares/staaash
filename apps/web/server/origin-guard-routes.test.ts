import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestSession } from "@/server/auth/guards";
import { POST as createArchive } from "@/app/api/files/archives/route";
import { POST as completeUploadSession } from "@/app/api/uploads/sessions/[id]/complete/route";
import {
  DELETE as cancelUploadSession,
  PATCH as patchUploadSession,
} from "@/app/api/uploads/sessions/[id]/route";
import { POST as createUploadSession } from "@/app/api/uploads/sessions/route";
import { scheduleZipArchiveGenerate } from "@staaash/db/jobs";
import { createResumableSession } from "@/server/uploads/session-service";

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(),
}));

vi.mock("@/server/uploads", () => ({
  UploadError: class UploadError extends Error {
    code = "UPLOAD_ERROR";
    status = 400;
  },
  assertUploadSizeAllowed: vi.fn(),
  computeFileSha256: vi.fn(),
}));

vi.mock("@/server/uploads/session-service", () => ({
  createResumableSession: vi.fn(),
  findActiveResumableSession: vi.fn(),
  markSessionCancelled: vi.fn(),
  markSessionCompleted: vi.fn(),
  updateSessionProgress: vi.fn(),
}));

vi.mock("@/server/files/service", () => ({
  filesService: {
    commitResumableUpload: vi.fn(),
  },
}));

vi.mock("@/server/files/errors", () => ({
  FilesError: class FilesError extends Error {
    code = "FILES_ERROR";
    status = 400;
  },
}));

vi.mock("@/server/files/repository", () => ({
  prismaFilesRepository: {
    findFileById: vi.fn(),
    findFolderById: vi.fn(),
  },
}));

vi.mock("@/server/settings", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@staaash/db/jobs", () => ({
  scheduleZipArchiveGenerate: vi.fn(),
}));

vi.mock("@staaash/db/zip-archives", () => ({
  ZIP_ARCHIVE_STATUS_FAILED: "failed",
  ZIP_ARCHIVE_STATUS_READY: "ready",
  buildZipContentKey: vi.fn(),
  findOrCreateZipArchive: vi.fn(),
}));

const crossOriginRequest = (path: string, method: string) =>
  new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      accept: "application/json",
      host: "localhost:3000",
      origin: "https://evil.example",
    },
  });

const expectCrossOriginRejection = async (response: Response) => {
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: "Cross-origin requests are not allowed.",
  });
  expect(getRequestSession).not.toHaveBeenCalled();
};

describe("mutating route same-origin guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects cross-origin upload session creation before auth or storage work", async () => {
    const response = await createUploadSession(
      crossOriginRequest("/api/uploads/sessions", "POST"),
    );

    await expectCrossOriginRejection(response);
    expect(createResumableSession).not.toHaveBeenCalled();
  });

  it("rejects cross-origin upload session patching before auth", async () => {
    const response = await patchUploadSession(
      crossOriginRequest("/api/uploads/sessions/upload-1", "PATCH"),
      { params: Promise.resolve({ id: "upload-1" }) },
    );

    await expectCrossOriginRejection(response);
  });

  it("rejects cross-origin upload session cancellation before auth", async () => {
    const response = await cancelUploadSession(
      crossOriginRequest("/api/uploads/sessions/upload-1", "DELETE"),
      { params: Promise.resolve({ id: "upload-1" }) },
    );

    await expectCrossOriginRejection(response);
  });

  it("rejects cross-origin upload completion before auth", async () => {
    const response = await completeUploadSession(
      crossOriginRequest("/api/uploads/sessions/upload-1/complete", "POST"),
      { params: Promise.resolve({ id: "upload-1" }) },
    );

    await expectCrossOriginRejection(response);
  });

  it("rejects cross-origin archive creation before auth or job scheduling", async () => {
    const response = await createArchive(
      crossOriginRequest("/api/files/archives", "POST"),
    );

    await expectCrossOriginRejection(response);
    expect(scheduleZipArchiveGenerate).not.toHaveBeenCalled();
  });
});
