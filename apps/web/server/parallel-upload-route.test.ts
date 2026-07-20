import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST as completeUpload } from "@/app/api/uploads/sessions/[id]/complete/route";
import { PATCH as patchUpload } from "@/app/api/uploads/sessions/[id]/route";
import { getRequestSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import { computeFileSha256 } from "@/server/uploads";
import {
  beginSessionCommit,
  failAndCleanupResumableSession,
  findActiveResumableSession,
  findCompletedUploadChunk,
  recordCompletedUploadChunk,
} from "@/server/uploads/session-service";

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(),
}));

vi.mock("@/server/storage-mutations", () => ({
  withStorageLocks: vi.fn(
    async ({ callback }: { callback: () => Promise<unknown> }) => callback(),
  ),
}));

vi.mock("@/server/uploads/session-service", () => ({
  beginSessionCommit: vi.fn(),
  failAndCleanupResumableSession: vi.fn(),
  findActiveResumableSession: vi.fn(),
  findCompletedUploadChunk: vi.fn(),
  recordCompletedUploadChunk: vi.fn(),
  updateSessionProgress: vi.fn(),
}));

vi.mock("@/server/uploads", () => ({
  computeFileSha256: vi.fn(),
}));

vi.mock("@/server/files/service", () => ({
  filesService: {
    commitResumableUpload: vi.fn(),
  },
}));

const temporaryPaths: string[] = [];

const createTempUpload = async (size: number) => {
  const target = path.join(
    os.tmpdir(),
    `staaash-parallel-upload-${randomUUID()}`,
  );
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, "wx");
  await handle.truncate(size);
  await handle.close();
  temporaryPaths.push(target);
  return target;
};

const uploadSession = (tmpPath: string, receivedBytes = 0) => ({
  id: "session-1",
  ownerUserId: "user-1",
  folderId: "folder-1",
  originalName: "video.mp4",
  mimeType: "video/mp4",
  totalSizeBytes: 10,
  receivedBytes,
  expectedChecksum: null,
  protocolVersion: 2,
  chunkSizeBytes: 4,
  completedChunks: [],
  tmpPath,
  conflictStrategy: "safeRename",
  status: "receiving",
  expiresAt: new Date("2026-07-17T00:00:00.000Z"),
  createdAt: new Date("2026-07-16T00:00:00.000Z"),
});

const patchRequest = (range: string, body: Uint8Array) =>
  new NextRequest("http://localhost:3000/api/uploads/sessions/session-1", {
    method: "PATCH",
    headers: {
      "content-length": String(body.byteLength),
      "content-range": range,
      "content-type": "application/octet-stream",
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    body: body.slice().buffer as ArrayBuffer,
  });

describe("parallel upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRequestSession).mockResolvedValue({
      user: { id: "user-1", role: "owner" },
    } as Awaited<ReturnType<typeof getRequestSession>>);
    vi.mocked(findCompletedUploadChunk).mockResolvedValue(null);
    vi.mocked(recordCompletedUploadChunk).mockResolvedValue(4);
  });

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((target) => rm(target, { force: true })),
    );
  });

  it("writes an aligned chunk at its offset even when it arrives first", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );

    const response = await patchUpload(
      patchRequest("bytes 4-7/10", new Uint8Array([1, 2, 3, 4])),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(200);
    expect(recordCompletedUploadChunk).toHaveBeenCalledWith({
      sessionId: "session-1",
      chunkIndex: 1,
      startByte: 4,
      endByte: 7,
      sizeBytes: 4,
    });
    expect(Array.from((await readFile(tmpPath)).subarray(4, 8))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("treats an already completed chunk as a safe retry", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath, 4),
    );
    vi.mocked(findCompletedUploadChunk).mockResolvedValue({
      chunkIndex: 1,
      startByte: 4,
      endByte: 7,
      sizeBytes: 4,
    });

    const response = await patchUpload(
      patchRequest("bytes 4-7/10", new Uint8Array([9, 9, 9, 9])),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(200);
    expect(recordCompletedUploadChunk).not.toHaveBeenCalled();
  });

  it("rejects ranges that do not match the negotiated chunk size", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );

    const response = await patchUpload(
      patchRequest("bytes 2-5/10", new Uint8Array([1, 2, 3, 4])),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(400);
    expect(recordCompletedUploadChunk).not.toHaveBeenCalled();
  });

  it("refuses completion until every exact chunk is recorded", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue({
      ...uploadSession(tmpPath, 8),
      completedChunks: [
        { chunkIndex: 0, startByte: 0, endByte: 3, sizeBytes: 4 },
        { chunkIndex: 1, startByte: 4, endByte: 7, sizeBytes: 4 },
      ],
    });

    const response = await completeUpload(
      new NextRequest(
        "http://localhost:3000/api/uploads/sessions/session-1/complete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "localhost:3000",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ expectedChecksum: "a".repeat(64) }),
        },
      ),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(400);
    expect(filesService.commitResumableUpload).not.toHaveBeenCalled();
  });

  it("verifies the final file checksum before committing it", async () => {
    const tmpPath = await createTempUpload(10);
    const expectedChecksum = "a".repeat(64);
    vi.mocked(findActiveResumableSession).mockResolvedValue({
      ...uploadSession(tmpPath, 10),
      completedChunks: [
        { chunkIndex: 0, startByte: 0, endByte: 3, sizeBytes: 4 },
        { chunkIndex: 1, startByte: 4, endByte: 7, sizeBytes: 4 },
        { chunkIndex: 2, startByte: 8, endByte: 9, sizeBytes: 2 },
      ],
    });
    vi.mocked(computeFileSha256).mockResolvedValue(expectedChecksum);
    vi.mocked(filesService.commitResumableUpload).mockResolvedValue({
      id: "file-1",
    } as never);

    const response = await completeUpload(
      new NextRequest(
        "http://localhost:3000/api/uploads/sessions/session-1/complete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "localhost:3000",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ expectedChecksum }),
        },
      ),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(201);
    expect(beginSessionCommit).toHaveBeenCalledWith({
      id: "session-1",
      ownerUserId: "user-1",
      expectedChecksum,
    });
    expect(failAndCleanupResumableSession).not.toHaveBeenCalled();
    expect(filesService.commitResumableUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadSessionId: "session-1",
        contentChecksum: expectedChecksum,
      }),
    );
  });

  it("terminalizes and cleans staging after a checksum mismatch", async () => {
    const tmpPath = await createTempUpload(10);
    const expectedChecksum = "a".repeat(64);
    vi.mocked(findActiveResumableSession).mockResolvedValue({
      ...uploadSession(tmpPath, 10),
      completedChunks: [
        { chunkIndex: 0, startByte: 0, endByte: 3, sizeBytes: 4 },
        { chunkIndex: 1, startByte: 4, endByte: 7, sizeBytes: 4 },
        { chunkIndex: 2, startByte: 8, endByte: 9, sizeBytes: 2 },
      ],
    });
    vi.mocked(computeFileSha256).mockResolvedValue("b".repeat(64));

    const response = await completeUpload(
      new NextRequest(
        "http://localhost:3000/api/uploads/sessions/session-1/complete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: "localhost:3000",
            origin: "http://localhost:3000",
          },
          body: JSON.stringify({ expectedChecksum }),
        },
      ),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHECKSUM_MISMATCH",
    });
    expect(failAndCleanupResumableSession).toHaveBeenCalledWith({
      id: "session-1",
      ownerUserId: "user-1",
      tmpPath,
    });
    expect(filesService.commitResumableUpload).not.toHaveBeenCalled();
  });
});
