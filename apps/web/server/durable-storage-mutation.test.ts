import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertStorageFilesystemSupported: vi.fn(),
  findStorageMutationByIdempotencyKey: vi.fn(),
  findUnique: vi.fn(),
  prepareStorageMutationParent: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({ instance: { findUnique: mocks.findUnique } }),
}));

vi.mock("@staaash/db/storage-mutations", () => ({
  findStorageMutationByIdempotencyKey:
    mocks.findStorageMutationByIdempotencyKey,
  prepareStorageMutationParent: mocks.prepareStorageMutationParent,
  StorageMutationConflictError: class extends Error {},
}));

vi.mock("@staaash/db/storage-mutation-executor", () => ({
  assertStorageFilesystemSupported: mocks.assertStorageFilesystemSupported,
}));

vi.mock("@/server/storage", () => ({ getStorageRoot: () => "storage" }));

import { prepareDurableStorageMutationParent } from "./durable-storage-mutation";

const input = {
  kind: "batch_move" as const,
  ownerUserId: "owner-1",
  idempotencyKey: "batch-1",
  requestHash: "request-1",
  intentJson: { version: 1, items: [] },
};

describe("prepareDurableStorageMutationParent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("replays a completed parent while the storage protocol is unavailable", async () => {
    const mutation = { ...input, id: "mutation-1", status: "succeeded" };
    mocks.findStorageMutationByIdempotencyKey.mockResolvedValue(mutation);
    mocks.findUnique.mockResolvedValue({ storageProtocolVersion: 1 });

    await expect(prepareDurableStorageMutationParent(input)).resolves.toEqual({
      mutation,
      replayed: true,
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.assertStorageFilesystemSupported).not.toHaveBeenCalled();
    expect(mocks.prepareStorageMutationParent).not.toHaveBeenCalled();
  });

  it("does not prepare a new parent before storage recovery finishes", async () => {
    mocks.findStorageMutationByIdempotencyKey.mockResolvedValue(null);
    mocks.findUnique.mockResolvedValue({ storageProtocolVersion: 1 });

    await expect(prepareDurableStorageMutationParent(input)).rejects.toThrow(
      "Storage mutations are unavailable until storage recovery finishes.",
    );
    expect(mocks.prepareStorageMutationParent).not.toHaveBeenCalled();
  });
});
