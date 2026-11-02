import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executorMocks = vi.hoisted(() => ({
  calculateStorageFileChecksum: vi.fn(),
  requireStorageRegularFile: vi.fn(),
}));

vi.mock("@staaash/db/reconciliation", () => ({}));
vi.mock("@staaash/db/storage-mutation-executor", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@staaash/db/storage-mutation-executor")
  >()),
  calculateStorageFileChecksum: executorMocks.calculateStorageFileChecksum,
  requireStorageRegularFile: executorMocks.requireStorageRegularFile,
}));

const { collectRestoreReconciliationIssues } =
  await import("./restore-reconciliation.js");

describe("restore reconciliation original integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executorMocks.requireStorageRegularFile.mockResolvedValue(
      "C:/storage/files/member/file.txt",
    );
  });

  it("does not read file contents when metadata has no checksum", async () => {
    const filesRoot = await mkdtemp(path.join(os.tmpdir(), "staaash-check-"));
    try {
      await expect(
        collectRestoreReconciliationIssues({
          fileRecords: [
            {
              id: "file-1",
              storageKey: "files/member/file.txt",
              contentChecksum: null,
            },
          ],
          filesRoot,
        }).then((result) => result.missingOriginals),
      ).resolves.toEqual([]);

      expect(executorMocks.requireStorageRegularFile).toHaveBeenCalledWith(
        filesRoot,
        "files/member/file.txt",
      );
      expect(executorMocks.calculateStorageFileChecksum).not.toHaveBeenCalled();
    } finally {
      await rm(filesRoot, { recursive: true, force: true });
    }
  });
});
