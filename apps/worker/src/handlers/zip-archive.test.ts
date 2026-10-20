import os from "node:os";
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";

import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

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
    vi.useRealTimers();
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  it("waits for a brief source publication, then journals replacement", async () => {
    mocks.listBlockingStorageMutationsForEntities.mockResolvedValueOnce([
      { mutation: { id: "thumbnail-publication" } },
    ]);
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

    let sourceReads = 0;
    mocks.getPrisma.mockReturnValue({
      folder: { findMany: vi.fn(async () => []) },
      file: {
        findMany: vi.fn(async () => [
          {
            id: "file-1",
            ownerUserId: "owner-1",
            folderId: null,
            originalName: "source.txt",
            storageKey:
              ++sourceReads === 1
                ? "files/owner-1/old-name.txt"
                : "files/owner-1/source.txt",
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

    expect(mocks.listBlockingStorageMutationsForEntities).toHaveBeenCalledTimes(
      2,
    );
    expect(mocks.runWorkerStorageMutation).toHaveBeenCalledTimes(1);
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

  it.each(["deadline", "cancellation"])(
    "does not read or publish blocked sources after %s",
    async (stop) => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "staaash-zip-blocked-"));
      mocks.getPrisma.mockReturnValue({
        folder: { findMany: vi.fn(async () => []) },
        file: {
          findMany: vi.fn(async () => [
            { id: "file-1", storageKey: "source.txt" },
          ]),
        },
      });
      mocks.listBlockingStorageMutationsForEntities.mockResolvedValue([
        { mutation: { id: "source-move" } },
      ]);
      vi.useFakeTimers();
      const controller = new AbortController();
      const running = handleZipArchiveGenerate(
        createJob(),
        {
          filesRoot: tempRoot,
          tmpRoot: path.join(tempRoot, "tmp"),
          heartbeatPath: path.join(tempRoot, "heartbeat.json"),
          pendingDeleteRoot: path.join(tempRoot, "pending-delete"),
          uploadStagingTtlMs: 1,
        },
        {
          signal: controller.signal,
          workerId: "worker-1",
          storagePaths: {
            filesRoot: tempRoot,
            tmpRoot: tempRoot,
            heartbeatPath: tempRoot,
            pendingDeleteRoot: tempRoot,
            uploadStagingTtlMs: 1,
          },
          updateProgress: async () => {},
          emitEvent: async () => {},
        },
      );
      const rejected =
        stop === "deadline"
          ? expect(running).rejects.toThrow("source-move")
          : expect(running).rejects.toMatchObject({ code: "UPLOAD_CANCELLED" });
      await vi.waitFor(() =>
        expect(
          mocks.listBlockingStorageMutationsForEntities,
        ).toHaveBeenCalled(),
      );
      if (stop === "cancellation") controller.abort();
      else await vi.advanceTimersByTimeAsync(5100);
      await rejected;
      expect(mocks.runWorkerStorageMutation).not.toHaveBeenCalled();
      if (stop === "deadline")
        expect(mocks.updateZipArchiveFailed).not.toHaveBeenCalled();
      await expect(
        readFile(path.join(tempRoot, "tmp/archives/archive-1.zip.tmp")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
  );

  it.each([
    { folderIds: ["a", "b"], nestedPath: "Alpha/Empty-A/nested.txt" },
    {
      folderIds: ["a", "a-child", "b"],
      nestedPath: "Alpha/Empty-A/nested.txt",
    },
    { folderIds: ["a-child", "a", "b"], nestedPath: "Empty-A/nested.txt" },
  ])(
    "preserves file and directory paths for $folderIds",
    async ({ folderIds, nestedPath }) => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "staaash-zip-folders-"));
      mocks.findZipArchiveById.mockResolvedValue({
        id: "archive-1",
        userId: "owner-1",
        status: "queued",
        storageRevision: 0,
        idsJson: { fileIds: ["direct"], folderIds },
      });
      const folders = [
        { id: "a", name: "Alpha", parentId: null },
        { id: "a-child", name: "Empty-A", parentId: "a" },
        { id: "b", name: "Beta", parentId: null },
        { id: "b-child", name: "Empty-B", parentId: "b" },
        { id: "unselected", name: "Other", parentId: null },
      ].map((folder) => ({
        ...folder,
        ownerUserId: "owner-1",
        isFilesRoot: false,
        deletedAt: null,
        storageRevision: 0,
      }));
      const files = [
        { id: "nested", folderId: "a-child", originalName: "nested.txt" },
        { id: "direct", folderId: "unselected", originalName: "direct.txt" },
      ].map((file) => ({
        ...file,
        ownerUserId: "owner-1",
        storageKey: file.originalName,
        deletedAt: null,
        storageRevision: 0,
      }));
      for (const file of files) {
        await writeFile(path.join(tempRoot, file.storageKey), file.id);
      }
      mocks.getPrisma.mockReturnValue({
        folder: { findMany: async () => folders },
        file: { findMany: async () => files },
      });
      await handleZipArchiveGenerate(createJob(), {
        filesRoot: tempRoot,
        tmpRoot: path.join(tempRoot, "tmp"),
        heartbeatPath: path.join(tempRoot, "heartbeat.json"),
        pendingDeleteRoot: path.join(tempRoot, "pending-delete"),
        uploadStagingTtlMs: 1,
      });
      // Read the ZIP's central directory to check the actual published entry names.
      const bytes = await readFile(
        path.join(tempRoot, "tmp/archives/archive-1.zip.tmp"),
      );
      const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      let offset = bytes.readUInt32LE(end + 16);
      const names: string[] = [];
      for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
        expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
        const length = bytes.readUInt16LE(offset + 28);
        names.push(
          bytes.subarray(offset + 46, offset + 46 + length).toString(),
        );
        offset +=
          46 +
          length +
          bytes.readUInt16LE(offset + 30) +
          bytes.readUInt16LE(offset + 32);
      }
      expect(names.sort()).toEqual(
        [
          "Alpha/",
          "Alpha/Empty-A/",
          "Beta/",
          "Beta/Empty-B/",
          ...(folderIds.includes("a-child") ? ["Empty-A/"] : []),
          nestedPath,
          "direct.txt",
        ].sort(),
      );
    },
  );

  it.each([
    { name: "random.txt", content: randomBytes(262144), method: 0 },
    {
      name: "document.jpg",
      content: Buffer.from("generated document\n".repeat(15000)),
      method: 8,
    },
  ])(
    "preserves $name bytes with ZIP method $method",
    async ({ name, content, method }) => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "staaash-zip-content-"));
      await writeFile(path.join(tempRoot, name), content);
      mocks.getPrisma.mockReturnValue({
        file: {
          findMany: async () => [
            {
              id: "file-1",
              originalName: name,
              storageKey: name,
              folderId: null,
              storageRevision: 0,
            },
          ],
        },
      });
      await handleZipArchiveGenerate(createJob(), {
        filesRoot: tempRoot,
        tmpRoot: path.join(tempRoot, "tmp"),
        heartbeatPath: path.join(tempRoot, "heartbeat.json"),
        pendingDeleteRoot: path.join(tempRoot, "pending-delete"),
        uploadStagingTtlMs: 1,
      });
      const bytes = await readFile(
        path.join(tempRoot, "tmp/archives/archive-1.zip.tmp"),
      );
      const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      const central = bytes.readUInt32LE(end + 16);
      expect(bytes.readUInt16LE(central + 10)).toBe(method);
      const start = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
      const payload = bytes.subarray(
        start,
        start + bytes.readUInt32LE(central + 20),
      );
      const extracted = method === 0 ? payload : inflateRawSync(payload);
      expect(extracted.equals(content)).toBe(true);
      expect(mocks.runWorkerStorageMutation).toHaveBeenCalledOnce();
    },
  );

  it.each(["missing", "directory"])(
    "fails an archive with a %s source without publishing it",
    async (source) => {
      tempRoot = await mkdtemp(path.join(os.tmpdir(), "staaash-zip-missing-"));
      if (source === "directory") await mkdir(path.join(tempRoot, source));
      mocks.getPrisma.mockReturnValue({
        file: {
          findMany: async () => [
            {
              id: "file-1",
              originalName: source,
              storageKey: source,
              storageRevision: 0,
            },
          ],
        },
      });
      await expect(
        handleZipArchiveGenerate(createJob(), {
          filesRoot: tempRoot,
          tmpRoot: path.join(tempRoot, "tmp"),
          heartbeatPath: path.join(tempRoot, "heartbeat.json"),
          pendingDeleteRoot: path.join(tempRoot, "pending-delete"),
          uploadStagingTtlMs: 1,
        }),
      ).rejects.toThrow(source === "missing" ? "ENOENT" : "not a file");
      expect(mocks.updateZipArchiveFailed).toHaveBeenCalledWith(
        "archive-1",
        expect.any(String),
      );
      expect(mocks.runWorkerStorageMutation).not.toHaveBeenCalled();
    },
  );
});
