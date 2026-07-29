import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertWorkerMutationMayStart: vi.fn(),
  findZipArchiveById: vi.fn(),
  getPrisma: vi.fn(),
  listBlockingStorageMutationsForEntities: vi.fn(),
  runWorkerStorageMutation: vi.fn(),
  updateZipArchiveFailed: vi.fn(),
  updateZipArchiveProcessing: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@staaash/db/zip-archives", () => ({
  ZIP_ARCHIVE_STATUS_READY: "ready",
  findZipArchiveById: mocks.findZipArchiveById,
  updateZipArchiveFailed: mocks.updateZipArchiveFailed,
  updateZipArchiveProcessing: mocks.updateZipArchiveProcessing,
  updateZipArchiveReady: vi.fn(),
}));

vi.mock("@staaash/db/storage-mutations", () => ({
  listBlockingStorageMutationsForEntities:
    mocks.listBlockingStorageMutationsForEntities,
}));

vi.mock("../durable-storage-mutation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../durable-storage-mutation.js")>()),
  assertWorkerMutationMayStart: mocks.assertWorkerMutationMayStart,
  runWorkerStorageMutation: mocks.runWorkerStorageMutation,
  StorageMutationOwnedError: class StorageMutationOwnedError extends Error {},
}));

const { handleZipArchiveGenerate } = await import("./zip-archive.js");

const fixedNow = new Date("2026-07-28T12:00:00.000Z");
const createJob = (): BackgroundJobRecord => ({
  id: "job-1",
  kind: "zip.archive.generate",
  status: "running",
  payloadJson: { archiveId: "archive-1" },
  dedupeKey: "zip.archive.generate:archive-1",
  runAt: fixedNow,
  lockedAt: null,
  lockedBy: null,
  attemptCount: 1,
  maxAttempts: 5,
  lastError: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
});

describe("zip archive handler", () => {
  let tempRoot: string | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertWorkerMutationMayStart.mockResolvedValue("new");
    mocks.listBlockingStorageMutationsForEntities.mockResolvedValue([]);
    mocks.runWorkerStorageMutation.mockResolvedValue({ id: "mutation-1" });
    mocks.findZipArchiveById.mockResolvedValue({
      id: "archive-1",
      userId: "owner-1",
      contentKey: "content-key",
      idsJson: { fileIds: ["file-1"], folderIds: [] },
      status: "queued",
      storageKey: null,
      fileName: null,
      sizeBytes: null,
      fileCount: null,
      error: null,
      expiresAt: new Date("2026-07-29T12:00:00.000Z"),
      createdAt: fixedNow,
      updatedAt: fixedNow,
      storageRevision: 4,
    });
  });

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("journals replacement through mutation-scoped incoming and backup paths", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "staaash-zip-archive-"));
    const filesRoot = path.join(tempRoot, "storage");
    const tmpRoot = path.join(filesRoot, "tmp");
    const sourcePath = path.join(filesRoot, "files", "owner-1", "source.txt");
    const existingArchivePath = path.join(
      filesRoot,
      "archives",
      "archive-1.zip",
    );
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await mkdir(path.dirname(existingArchivePath), { recursive: true });
    await writeFile(sourcePath, "source bytes");
    await writeFile(existingArchivePath, "old archive");

    mocks.getPrisma.mockReturnValue({
      folder: { findMany: vi.fn(async () => []) },
      file: {
        findMany: vi.fn(async () => [
          {
            id: "file-1",
            ownerUserId: "owner-1",
            folderId: null,
            originalName: "source.txt",
            storageKey: "files/owner-1/source.txt",
            deletedAt: null,
            storageRevision: 2,
          },
        ]),
        findUnique: vi.fn(),
      },
    });

    await handleZipArchiveGenerate(createJob(), {
      filesRoot,
      tmpRoot,
      heartbeatPath: path.join(tmpRoot, "worker-heartbeat.json"),
      pendingDeleteRoot: path.join(tmpRoot, "pending-delete"),
      uploadStagingTtlMs: 1,
    });

    expect(mocks.runWorkerStorageMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        mutationId: "archive-publish-archive-1-job-1",
        kind: "archive_publish",
        metadataOperations: [
          expect.objectContaining({
            entityType: "archive",
            entityId: "archive-1",
            preRevision: 4,
            data: expect.objectContaining({
              status: "ready",
              storageKey: "archives/archive-1.zip",
              fileName: "source.txt.zip",
              fileCount: 1,
            }),
          }),
        ],
        steps: [
          expect.objectContaining({
            sourceKey: "tmp/archives/archive-1.zip.tmp",
            targetKey:
              "tmp/incoming/archive-publish-archive-1-job-1/archive-1.zip",
          }),
          expect.objectContaining({
            sourceKey: "archives/archive-1.zip",
            targetKey:
              "tmp/backup/archive-publish-archive-1-job-1/archive-1.zip",
          }),
          expect.objectContaining({
            sourceKey:
              "tmp/incoming/archive-publish-archive-1-job-1/archive-1.zip",
            targetKey: "archives/archive-1.zip",
          }),
          expect.objectContaining({
            action: "delete_file",
            targetKey:
              "tmp/backup/archive-publish-archive-1-job-1/archive-1.zip",
          }),
        ],
      }),
    );
  });
});
