import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

import { app } from "@/server/http/app";

import { StorageMutationConflictError } from "@staaash/db/storage-mutations";
import { StorageAdmissionBusyError } from "@staaash/db/storage-transactions";

import { getRequestSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import { ResumableCompletionError } from "@/server/files/errors";
import { computeFileSha256 } from "@/server/uploads";
import {
  beginSessionCommit,
  failAndCleanupResumableSession,
  findActiveResumableSession,
  findResumableSessionStatus,
  recordResumableCommitRecoveryError,
  restoreResumableSessionAfterCommitRollback,
  writeAndRecordUploadChunk,
} from "@/server/uploads/session-service";

vi.mock("@/server/auth/guards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/guards")>()),
  getRequestSession: vi.fn(),
}));

vi.mock("@/server/durable-storage-mutation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/durable-storage-mutation")
  >()),
  assertStorageProtocolReady: vi.fn(async () => undefined),
  StorageProtocolNotReadyError: class extends Error {},
}));

vi.mock("@/server/uploads/session-service", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/uploads/session-service")
  >()),
  beginSessionCommit: vi.fn(),
  failAndCleanupResumableSession: vi.fn(),
  findActiveResumableSession: vi.fn(),
  findCompletedResumableSession: vi.fn(),
  findResumableSessionStatus: vi.fn(),
  recordResumableCommitRecoveryError: vi.fn(),
  restoreResumableSessionAfterCommitRollback: vi.fn(),
  updateSessionProgress: vi.fn(),
  writeAndRecordUploadChunk: vi.fn(),
}));

vi.mock("@/server/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/uploads")>()),
  computeFileSha256: vi.fn(),
}));

vi.mock("@/server/files/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/service")>()),
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

const patchRequest = (
  range: string,
  body: Uint8Array,
  contentLength: string | null = String(body.byteLength),
) =>
  new Request("http://localhost:3000/api/uploads/sessions/session-1", {
    method: "PATCH",
    headers: {
      ...(contentLength === null ? {} : { "content-length": contentLength }),
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
    vi.mocked(writeAndRecordUploadChunk).mockImplementation(
      async ({ writeBytes }) => {
        await writeBytes(new AbortController().signal);
        return 4;
      },
    );
  });

  afterEach(async () => {
    await Promise.all(
      temporaryPaths.splice(0).map((target) => rm(target, { force: true })),
    );
  });

  it("writes an aligned chunk at its offset even when it arrives first", async () => {
    const tmpPath = await createTempUpload(10);
    const request = patchRequest("bytes 4-7/10", new Uint8Array([1, 2, 3, 4]));
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );
    vi.mocked(writeAndRecordUploadChunk).mockImplementationOnce(
      async ({ writeBytes }) => {
        expect(request.bodyUsed).toBe(false);
        await writeBytes(new AbortController().signal);
        expect(request.bodyUsed).toBe(true);
        return 4;
      },
    );

    const response = await app.request(request);

    expect(response.status).toBe(200);
    expect(findActiveResumableSession).toHaveBeenCalledWith(
      "session-1",
      "user-1",
      false,
    );
    expect(writeAndRecordUploadChunk).toHaveBeenCalledWith({
      sessionId: "session-1",
      ownerUserId: "user-1",
      chunkIndex: 1,
      startByte: 4,
      endByte: 7,
      sizeBytes: 4,
      writeBytes: expect.any(Function),
    });
    expect(Array.from((await readFile(tmpPath)).subarray(4, 8))).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("rejects a short streamed chunk without recording it", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );

    const response = await app.request(
      patchRequest("bytes 4-7/10", new Uint8Array([1, 2, 3]), null),
    );

    expect(response.status).toBe(400);
    expect(writeAndRecordUploadChunk).toHaveBeenCalledOnce();
    expect((await readFile(tmpPath))[7]).toBe(0);
  });

  it("does not write past the declared chunk range", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );

    const response = await app.request(
      patchRequest("bytes 4-7/10", new Uint8Array([1, 2, 3, 4, 5]), null),
    );

    expect(response.status).toBe(400);
    expect(writeAndRecordUploadChunk).toHaveBeenCalledOnce();
    expect((await readFile(tmpPath))[8]).toBe(0);
  });

  it("treats an already completed chunk as a safe retry", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath, 4),
    );
    vi.mocked(writeAndRecordUploadChunk).mockResolvedValue(4);

    const response = await app.request(
      patchRequest("bytes 4-7/10", new Uint8Array([9, 9, 9, 9])),
    );

    expect(response.status).toBe(200);
    expect(writeAndRecordUploadChunk).toHaveBeenCalledOnce();
  });

  it("asks the client to retry when a chunk lock times out", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );
    vi.mocked(writeAndRecordUploadChunk).mockRejectedValue(
      new Error("UPLOAD_CHUNK_LOCK_TIMEOUT"),
    );

    const response = await app.request(
      patchRequest("bytes 4-7/10", new Uint8Array([1, 2, 3, 4])),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("rejects ranges that do not match the negotiated chunk size", async () => {
    const tmpPath = await createTempUpload(10);
    vi.mocked(findActiveResumableSession).mockResolvedValue(
      uploadSession(tmpPath),
    );

    const response = await app.request(
      patchRequest("bytes 2-5/10", new Uint8Array([1, 2, 3, 4])),
    );

    expect(response.status).toBe(400);
    expect(writeAndRecordUploadChunk).not.toHaveBeenCalled();
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

    const response = await app.request(
      new Request(
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
    );

    expect(response.status).toBe(400);
    expect(filesService.commitResumableUpload).not.toHaveBeenCalled();
  });

  it("asks the client to retry completion while recovery is running", async () => {
    vi.mocked(findActiveResumableSession).mockResolvedValueOnce(null);
    vi.mocked(findResumableSessionStatus).mockResolvedValueOnce({
      status: "committing",
    });

    const response = await app.request(
      new Request(
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
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    await expect(response.json()).resolves.toMatchObject({
      code: "RESUMABLE_COMMIT_RETRYABLE",
    });
    expect(findResumableSessionStatus).toHaveBeenCalledWith(
      "session-1",
      "user-1",
    );
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

    const response = await app.request(
      new Request(
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

    const response = await app.request(
      new Request(
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

  it("restores a retryable session when checksum reading fails", async () => {
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
    vi.mocked(computeFileSha256).mockRejectedValue(new Error("read failed"));

    const response = await app.request(
      new Request(
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
    );

    expect(response.status).toBe(503);
    expect(beginSessionCommit).toHaveBeenCalledOnce();
    expect(restoreResumableSessionAfterCommitRollback).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1", ownerUserId: "user-1" }),
    );
    expect(failAndCleanupResumableSession).not.toHaveBeenCalled();
    expect(filesService.commitResumableUpload).not.toHaveBeenCalled();
  });

  it("keeps staging after a safely rolled-back completion failure", async () => {
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
    vi.mocked(filesService.commitResumableUpload).mockRejectedValue(
      new ResumableCompletionError("RESUMABLE_COMMIT_RETRYABLE"),
    );

    const response = await app.request(
      new Request(
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
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(failAndCleanupResumableSession).not.toHaveBeenCalled();
    expect(recordResumableCommitRecoveryError).not.toHaveBeenCalled();
  });

  it.each([
    () =>
      new StorageMutationConflictError(
        "STORAGE_MUTATION_IN_PROGRESS",
        "mutation-1",
      ),
    () => new StorageAdmissionBusyError(),
  ])(
    "restores the session when nothing was committed and returns a retryable response",
    async (refusal) => {
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
      const error = refusal();
      vi.mocked(filesService.commitResumableUpload).mockRejectedValue(error);

      const response = await app.request(
        new Request(
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
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
      await expect(response.json()).resolves.toMatchObject({
        code: error.code,
      });
      expect(restoreResumableSessionAfterCommitRollback).toHaveBeenCalledWith({
        id: "session-1",
        ownerUserId: "user-1",
        error,
      });
      expect(recordResumableCommitRecoveryError).not.toHaveBeenCalled();
    },
  );

  it("keeps recovery-required contention visible without restoring the session", async () => {
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
    vi.mocked(filesService.commitResumableUpload).mockRejectedValue(
      new StorageMutationConflictError(
        "STORAGE_RECOVERY_REQUIRED",
        "mutation-1",
      ),
    );

    const response = await app.request(
      new Request(
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
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      code: "STORAGE_RECOVERY_REQUIRED",
    });
    expect(restoreResumableSessionAfterCommitRollback).not.toHaveBeenCalled();
    expect(recordResumableCommitRecoveryError).not.toHaveBeenCalled();
  });
});
