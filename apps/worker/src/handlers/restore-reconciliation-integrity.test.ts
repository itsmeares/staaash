import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { collectMissingOriginals } = await import("./restore-reconciliation.js");

describe("restore reconciliation original integrity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executorMocks.requireStorageRegularFile.mockResolvedValue(
      "C:/storage/files/member/file.txt",
    );
  });

  it("does not read file contents when metadata has no checksum", async () => {
    await expect(
      collectMissingOriginals(
        [
          {
            id: "file-1",
            storageKey: "files/member/file.txt",
            contentChecksum: null,
          },
        ],
        "C:/storage",
      ),
    ).resolves.toEqual([]);

    expect(executorMocks.requireStorageRegularFile).toHaveBeenCalledWith(
      "C:/storage",
      "files/member/file.txt",
    );
    expect(executorMocks.calculateStorageFileChecksum).not.toHaveBeenCalled();
  });
});
