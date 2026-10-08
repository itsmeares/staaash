import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  claimAndExecuteStorageMutation: vi.fn(),
  findStorageMutation: vi.fn(),
  assertStorageFilesystemSupported: vi.fn(),
  findStorageMutationByIdempotencyKey: vi.fn(),
  findUnique: vi.fn(),
  prepareStorageMutation: vi.fn(),
  prepareStorageMutationParent: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({ instance: { findUnique: mocks.findUnique } }),
}));

vi.mock("@staaash/db/storage-mutations", () => ({
  applyStorageMutationIntentMetadata: vi.fn(),
  findStorageMutation: mocks.findStorageMutation,
  findStorageMutationByIdempotencyKey:
    mocks.findStorageMutationByIdempotencyKey,
  hashStorageMutationRequest: (value: unknown) => JSON.stringify(value),
  prepareStorageMutation: mocks.prepareStorageMutation,
  prepareStorageMutationParent: mocks.prepareStorageMutationParent,
  StorageMutationConflictError: class extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

vi.mock("@staaash/db/storage-mutation-executor", () => ({
  assertStorageFilesystemSupported: mocks.assertStorageFilesystemSupported,
  claimAndExecuteStorageMutation: mocks.claimAndExecuteStorageMutation,
}));

vi.mock("@/server/storage", () => ({ getStorageRoot: () => "storage" }));

import { StorageMutationConflictError } from "@staaash/db/storage-mutations";

import {
  prepareDurableStorageMutationParent,
  runDurableStorageMutation,
} from "./durable-storage-mutation";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const input = {
  kind: "batch_move" as const,
  ownerUserId: "owner-1",
  idempotencyKey: "batch-1",
  requestHash: "request-1",
  intentJson: { version: 1, items: [] },
};

describe("prepareDurableStorageMutationParent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ storageProtocolVersion: 2 });
    mocks.findStorageMutationByIdempotencyKey.mockResolvedValue(null);
  });

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
    mocks.findUnique.mockResolvedValue({ storageProtocolVersion: 1 });

    await expect(prepareDurableStorageMutationParent(input)).rejects.toThrow(
      "Storage mutations are unavailable until storage recovery finishes.",
    );
    expect(mocks.prepareStorageMutationParent).not.toHaveBeenCalled();
  });

  it("retries transient owner contention with the same request", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const conflict = new StorageMutationConflictError(
      "STORAGE_MUTATION_IN_PROGRESS",
    );
    const prepared = {
      mutation: { ...input, id: "mutation-1", status: "prepared" },
      replayed: false,
    };
    mocks.prepareStorageMutationParent
      .mockRejectedValueOnce(conflict)
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(prepared);

    const result = prepareDurableStorageMutationParent(input);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual(prepared);
    expect(mocks.prepareStorageMutationParent).toHaveBeenCalledTimes(3);
    expect(mocks.prepareStorageMutationParent).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining(input),
      { deadline: expect.any(Number) },
    );
    vi.useRealTimers();
  });

  it("does not retry recovery-required mutations", async () => {
    const conflict = new StorageMutationConflictError(
      "STORAGE_RECOVERY_REQUIRED",
    );
    mocks.prepareStorageMutationParent.mockRejectedValue(conflict);

    await expect(prepareDurableStorageMutationParent(input)).rejects.toBe(
      conflict,
    );
    expect(mocks.prepareStorageMutationParent).toHaveBeenCalledOnce();
  });

  it("stops retrying persistent contention", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const conflict = new StorageMutationConflictError(
      "STORAGE_MUTATION_IN_PROGRESS",
    );
    mocks.prepareStorageMutationParent.mockRejectedValue(conflict);

    const result = expect(
      prepareDurableStorageMutationParent(input),
    ).rejects.toBe(conflict);
    await vi.runAllTimersAsync();

    await result;
    expect(
      mocks.prepareStorageMutationParent.mock.calls.length,
    ).toBeGreaterThan(1);
    expect(
      mocks.prepareStorageMutationParent.mock.calls.every(
        ([first, second]) =>
          first.id === mocks.prepareStorageMutationParent.mock.calls[0][0].id &&
          second.deadline ===
            mocks.prepareStorageMutationParent.mock.calls[0][1].deadline,
      ),
    ).toBe(true);
    vi.useRealTimers();
  });
});

describe("runDurableStorageMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ storageProtocolVersion: 2 });
    mocks.findStorageMutationByIdempotencyKey.mockResolvedValue(null);
    mocks.claimAndExecuteStorageMutation.mockResolvedValue(undefined);
  });

  it("retries transient contention before executing an upload mutation", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const conflict = new StorageMutationConflictError(
      "STORAGE_MUTATION_IN_PROGRESS",
    );
    const mutation = {
      id: "upload-1",
      kind: "upload_create",
      ownerUserId: "owner-1",
      requestHash: "request-1",
      status: "prepared",
      intentJson: { version: 1, metadataOperations: [] },
    };
    mocks.prepareStorageMutation
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ mutation, replayed: false });
    mocks.findStorageMutation.mockResolvedValue({
      ...mutation,
      status: "succeeded",
    });

    const result = runDurableStorageMutation({
      kind: "upload_create",
      ownerUserId: "owner-1",
      idempotencyKey: "upload-1",
      metadataOperations: [],
      steps: [],
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledTimes(2);
    expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
    const [firstInput, firstOptions] =
      mocks.prepareStorageMutation.mock.calls[0];
    expect(firstInput.id).toEqual(expect.any(String));
    expect(firstInput.id).not.toBe("");
    expect(mocks.prepareStorageMutation.mock.calls[1]).toEqual([
      firstInput,
      firstOptions,
    ]);
    vi.useRealTimers();
  });

  it("cancels contended admission without preparing or executing another mutation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    mocks.prepareStorageMutation.mockRejectedValue(
      new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS"),
    );
    const pending = expect(
      runDurableStorageMutation({
        kind: "upload_create",
        ownerUserId: "owner-1",
        idempotencyKey: "cancelled-upload",
        metadataOperations: [],
        steps: [],
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_CANCELLED", status: 499 });
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.prepareStorageMutation).toHaveBeenCalledWith(
      expect.any(Object),
      {
        deadline: expect.any(Number),
        signal: controller.signal,
      },
    );
    controller.abort();
    await pending;
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains uncertain ownership when the post-failure lookup is unavailable", async () => {
    mocks.findStorageMutationByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("lookup unavailable"));
    mocks.prepareStorageMutation.mockRejectedValueOnce(
      new Error("connection lost after commit"),
    );
    await expect(
      runDurableStorageMutation({
        kind: "upload_create",
        ownerUserId: "owner-1",
        idempotencyKey: "uncertain-upload",
        mutationId: "stable-mutation",
        metadataOperations: [],
        steps: [],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_MUTATION_RECOVERING" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });
});
