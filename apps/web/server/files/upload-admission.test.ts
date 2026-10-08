import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  stageUpload: vi.fn(),
  cleanupStagedUpload: vi.fn(),
  assertStorageProtocolReady: vi.fn(),
}));

vi.mock("@staaash/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/client")>()),
  getPrisma: () => ({ storageMutation: { findUnique: mocks.findUnique } }),
}));
vi.mock("@/server/uploads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/uploads")>()),
  createUploadDeadline: vi.fn().mockResolvedValue(10_000),
  stageUpload: mocks.stageUpload,
  cleanupStagedUpload: mocks.cleanupStagedUpload,
}));
vi.mock("@/server/durable-storage-mutation", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/durable-storage-mutation")
  >()),
  assertStorageProtocolReady: mocks.assertStorageProtocolReady,
}));

import { createFilesService } from "./service";

const items = ["first.txt", "second.txt"].map((name) => ({
  clientKey: name,
  originalName: name,
  conflictStrategy: "fail" as const,
  file: new File(["hello"], name),
}));
const input = {
  actorUserId: "owner-1",
  actorRole: "member" as const,
  idempotencyKey: "upload-1",
  items,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cleanupStagedUpload.mockResolvedValue(undefined);
  mocks.assertStorageProtocolReady.mockResolvedValue(undefined);
  mocks.stageUpload.mockImplementation(async (item) => ({
    tmpPath: `tmp/${item.originalName}`,
    sizeBytes: 5n,
    actualChecksum: "checksum",
  }));
});

describe("upload admission staging ownership", () => {
  it("rejects an already cancelled upload before staging or reading storage state", async () => {
    await expect(
      createFilesService().uploadFiles({
        ...input,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_CANCELLED", status: 499 });
    expect(mocks.stageUpload).not.toHaveBeenCalled();
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.assertStorageProtocolReady).not.toHaveBeenCalled();
  });

  it("cleans both staged files when the second idempotency lookup fails", async () => {
    const error = new Error("synthetic lookup failure");
    mocks.findUnique.mockResolvedValueOnce(null).mockRejectedValueOnce(error);
    await expect(createFilesService().uploadFiles(input)).rejects.toBe(error);
    expect(mocks.stageUpload).toHaveBeenCalledTimes(2);
    expect(mocks.cleanupStagedUpload.mock.calls).toEqual([
      ["tmp/first.txt"],
      ["tmp/second.txt"],
    ]);
  });

  it("cleans the current staged file when its idempotency key belongs to another operation", async () => {
    mocks.findUnique.mockResolvedValueOnce({
      kind: "trash_file",
      ownerUserId: "owner-1",
    });
    await expect(createFilesService().uploadFiles(input)).rejects.toMatchObject(
      { code: "STORAGE_IDEMPOTENCY_KEY_REUSED" },
    );
    expect(mocks.stageUpload).toHaveBeenCalledOnce();
    expect(mocks.cleanupStagedUpload).toHaveBeenCalledExactlyOnceWith(
      "tmp/first.txt",
    );
  });
});
