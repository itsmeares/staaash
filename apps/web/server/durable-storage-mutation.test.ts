import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  StorageAdmissionBusyError,
  StorageTransactionUnavailableError,
} from "@staaash/db/storage-transactions";

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

vi.mock("@staaash/db/storage-mutations", async (importOriginal) => {
  const { StorageMutationRejectedError, storageMutationRejectionFromResult } =
    await importOriginal<typeof import("@staaash/db/storage-mutations")>();
  return {
    applyStorageMutationIntentMetadata: vi.fn(),
    findStorageMutation: mocks.findStorageMutation,
    findStorageMutationByIdempotencyKey:
      mocks.findStorageMutationByIdempotencyKey,
    hashStorageMutationRequest: (value: unknown) => JSON.stringify(value),
    prepareStorageMutation: mocks.prepareStorageMutation,
    prepareStorageMutationParent: mocks.prepareStorageMutationParent,
    StorageMutationRejectedError,
    storageMutationRejectionFromResult,
    StorageMutationConflictError: class extends Error {
      constructor(readonly code: string) {
        super(code);
      }
    },
  };
});

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

const input = {
  kind: "batch_move" as const,
  ownerUserId: "owner-1",
  idempotencyKey: "batch-1",
  requestHash: "request-1",
  intentJson: { version: 1, items: [] },
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

  it("logs unavailable preparation even when no journal exists", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new StorageTransactionUnavailableError(
      new Error("pool wait"),
    );
    mocks.prepareStorageMutation.mockRejectedValue(error);
    mocks.findStorageMutation.mockResolvedValue(null);

    await expect(
      runDurableStorageMutation({
        mutationId: "upload-not-prepared",
        kind: "upload_create",
        ownerUserId: "owner-1",
        metadataOperations: [],
        steps: [],
      }),
    ).rejects.toBe(error);
    expect(warn).toHaveBeenCalledWith(
      "[storage] Durable mutation preparation interrupted.",
      {
        mutationId: "upload-not-prepared",
        kind: "upload_create",
        status: "unknown",
        error,
      },
    );
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
    expect(mocks.prepareStorageMutation).toHaveBeenCalledTimes(2);
  });

  it("retries an absent preparation once with a fresh deadline and the same durable identity", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const start = Date.now();
    const error = new StorageTransactionUnavailableError(
      new Error("transaction expired"),
    );
    const mutation = {
      id: "upload-retry",
      kind: "upload_create",
      ownerUserId: "owner-1",
      status: "prepared",
      intentJson: { version: 1, metadataOperations: [] },
    };
    mocks.prepareStorageMutation
      .mockImplementationOnce(async () => {
        vi.setSystemTime(start + 5100);
        throw error;
      })
      .mockResolvedValueOnce({ mutation, replayed: false });
    mocks.findStorageMutation.mockResolvedValue({
      ...mutation,
      status: "succeeded",
    });
    await expect(
      runDurableStorageMutation({
        mutationId: mutation.id,
        kind: "upload_create",
        ownerUserId: "owner-1",
        idempotencyKey: "stable-upload-key",
        metadataOperations: [],
        steps: [],
        resultJson: { file: { id: "saved-file" } },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledTimes(2);
    expect(mocks.prepareStorageMutation.mock.calls[1][0]).toEqual(
      mocks.prepareStorageMutation.mock.calls[0][0],
    );
    expect(mocks.prepareStorageMutation.mock.calls[0][1].deadline).toBe(
      start + 5000,
    );
    expect(mocks.prepareStorageMutation.mock.calls[1][1].deadline).toBe(
      start + 10100,
    );
    expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
  });

  it("does not retry preparation when the primary lookup cannot establish absence", async () => {
    mocks.prepareStorageMutation.mockRejectedValue(
      new StorageTransactionUnavailableError(new Error("unknown commit")),
    );
    mocks.findStorageMutation.mockRejectedValue(
      new Error("database unavailable"),
    );
    await expect(
      runDurableStorageMutation({
        mutationId: "upload-unknown",
        kind: "upload_create",
        ownerUserId: "owner-1",
        metadataOperations: [],
        steps: [],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_MUTATION_RECOVERING" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });

  it("does not repeat preparation when its matching journal is already running", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.prepareStorageMutation.mockRejectedValue(
      new StorageTransactionUnavailableError(new Error("unknown commit")),
    );
    mocks.findStorageMutation.mockResolvedValue({
      id: "upload-running",
      kind: "upload_create",
      ownerUserId: "owner-1",
      status: "running",
      requestHash: JSON.stringify({ request: "stable" }),
    });
    await expect(
      runDurableStorageMutation({
        mutationId: "upload-running",
        kind: "upload_create",
        ownerUserId: "owner-1",
        metadataOperations: [],
        steps: [],
        requestHashPayload: { request: "stable" },
      }),
    ).rejects.toMatchObject({ code: "STORAGE_MUTATION_RECOVERING" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
    expect(mocks.claimAndExecuteStorageMutation).not.toHaveBeenCalled();
  });

  it("claims a late prepared commit atomically and preserves its original receipt", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const receipt = { file: { id: "original-file" } };
    const mutation = {
      id: "upload-late",
      kind: "upload_create",
      ownerUserId: "owner-1",
      status: "prepared",
      resultJson: receipt,
      intentJson: { version: 1, metadataOperations: [] },
    };
    mocks.prepareStorageMutation
      .mockRejectedValueOnce(
        new StorageTransactionUnavailableError(new Error("unknown commit")),
      )
      .mockResolvedValueOnce({ mutation, replayed: true });
    mocks.findStorageMutationByIdempotencyKey.mockResolvedValue(null);
    mocks.findStorageMutation.mockResolvedValue({
      ...mutation,
      status: "succeeded",
    });
    await expect(
      runDurableStorageMutation({
        mutationId: mutation.id,
        kind: "upload_create",
        ownerUserId: "owner-1",
        idempotencyKey: "late-key",
        metadataOperations: [],
        steps: [],
        resultJson: { file: { id: "unused-file" } },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
    expect(
      mocks.claimAndExecuteStorageMutation.mock.calls[0][0].resultJson(),
    ).toEqual(receipt);
  });

  it("uses a confirmed prepared journal after a lost acknowledgement without preparing twice", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const receipt = { file: { id: "original-file" } };
    const mutation = {
      id: "upload-ack",
      kind: "upload_create",
      ownerUserId: "owner-1",
      status: "prepared",
      requestHash: JSON.stringify({ request: "stable" }),
      resultJson: receipt,
      intentJson: { version: 1, metadataOperations: [] },
    };
    mocks.prepareStorageMutation.mockRejectedValue(
      new StorageTransactionUnavailableError(new Error("lost acknowledgement")),
    );
    mocks.findStorageMutation
      .mockResolvedValueOnce(mutation)
      .mockResolvedValueOnce({ ...mutation, status: "succeeded" });
    await expect(
      runDurableStorageMutation({
        mutationId: mutation.id,
        kind: "upload_create",
        ownerUserId: "owner-1",
        metadataOperations: [],
        steps: [],
        requestHashPayload: { request: "stable" },
        resultJson: { file: { id: "unused-file" } },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
    expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
    expect(
      mocks.claimAndExecuteStorageMutation.mock.calls[0][0].resultJson(),
    ).toEqual(receipt);
  });

  it("returns a succeeded journal if another executor finished before the error lookup", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mutation = {
      id: "upload-finished",
      kind: "upload_create",
      ownerUserId: "owner-1",
      status: "prepared",
      intentJson: { version: 1, metadataOperations: [] },
    };
    mocks.prepareStorageMutation.mockResolvedValue({
      mutation,
      replayed: false,
    });
    mocks.claimAndExecuteStorageMutation.mockRejectedValue(
      new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS"),
    );
    mocks.findStorageMutation.mockResolvedValue({
      ...mutation,
      status: "succeeded",
    });
    await expect(
      runDurableStorageMutation({
        kind: "upload_create",
        ownerUserId: "owner-1",
        metadataOperations: [],
        steps: [],
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledOnce();
  });

  it("logs the underlying execution error before returning recovery status", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = new StorageAdmissionBusyError();
    const mutation = {
      id: "upload-1",
      kind: "upload_create",
      ownerUserId: "owner-1",
      status: "prepared",
      intentJson: { version: 1, metadataOperations: [] },
    };
    mocks.prepareStorageMutation.mockResolvedValue({
      mutation,
      replayed: false,
    });
    mocks.claimAndExecuteStorageMutation.mockRejectedValue(error);
    mocks.findStorageMutation.mockResolvedValue({
      ...mutation,
      status: "retrying",
    });

    await expect(
      runDurableStorageMutation({
        kind: "upload_create",
        ownerUserId: "owner-1",
        metadataOperations: [],
        steps: [],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_MUTATION_RECOVERING" });
    expect(warn).toHaveBeenCalledWith(
      "[storage] Durable mutation execution interrupted.",
      { mutationId: "upload-1", kind: "upload_create", error },
    );
  });

  it.each([
    ["USER_STORAGE_QUOTA_EXCEEDED", 413],
    ["STORAGE_PATH_TOO_LONG", 400],
    [undefined, 503],
  ])(
    "preserves an aborted journal's rejection (%s)",
    async (abortedCode, status) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const mutation = {
        id: "upload-aborted",
        kind: "upload_create",
        ownerUserId: "owner-1",
        status: "prepared",
        intentJson: { version: 1, metadataOperations: [] },
      };
      mocks.prepareStorageMutation.mockResolvedValue({
        mutation,
        replayed: false,
      });
      mocks.claimAndExecuteStorageMutation.mockRejectedValue(
        new Error("execution interrupted"),
      );
      mocks.findStorageMutation.mockResolvedValue({
        ...mutation,
        status: "aborted",
        resultJson: abortedCode ? { abortedCode } : null,
      });

      await expect(
        runDurableStorageMutation({
          kind: "upload_create",
          ownerUserId: "owner-1",
          metadataOperations: [],
          steps: [],
        }),
      ).rejects.toMatchObject({
        name: "StorageMutationRejectedError",
        code: abortedCode ?? "STORAGE_MUTATION_ABORTED",
        status,
      });
      expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
    },
  );

  it.each([
    null,
    new Error("database unavailable"),
    new StorageMutationConflictError("STORAGE_MUTATION_IN_PROGRESS"),
  ])(
    "reports recovery when an interrupted execution's journal cannot be read (%s)",
    async (lookupError) => {
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const mutation = {
        id: "upload-unknown",
        kind: "upload_create",
        ownerUserId: "owner-1",
        status: "prepared",
        intentJson: { version: 1, metadataOperations: [] },
      };
      mocks.prepareStorageMutation.mockResolvedValue({
        mutation,
        replayed: false,
      });
      mocks.claimAndExecuteStorageMutation.mockRejectedValue(
        new Error("execution interrupted"),
      );
      if (lookupError) mocks.findStorageMutation.mockRejectedValue(lookupError);
      else mocks.findStorageMutation.mockResolvedValue(null);

      await expect(
        runDurableStorageMutation({
          kind: "upload_create",
          ownerUserId: "owner-1",
          metadataOperations: [],
          steps: [],
        }),
      ).rejects.toMatchObject({ code: "STORAGE_MUTATION_RECOVERING" });
    },
  );

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
      resultJson: { file: { id: "saved-file-1" } },
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toMatchObject({ status: "succeeded" });
    expect(mocks.prepareStorageMutation).toHaveBeenCalledTimes(2);
    expect(mocks.prepareStorageMutation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialResultJson: { file: { id: "saved-file-1" } },
      }),
      expect.any(Object),
    );
    expect(mocks.claimAndExecuteStorageMutation).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
