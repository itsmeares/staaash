import { describe, expect, it, vi } from "vitest";

import {
  commitStorageMutationMetadata,
  pruneSucceededStorageMutationResults,
  retryStorageMutationNow,
} from "./storage-mutations";

describe("durable storage mutation commit", () => {
  it("persists replay result in the metadata transaction before cleanup", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transactionClient = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: "mutation-1" }]),
      storageMutation: {
        findFirst: vi.fn().mockResolvedValue({ id: "mutation-1" }),
        updateMany,
      },
    };
    const client = {
      $transaction: async <T>(
        callback: (tx: typeof transactionClient) => Promise<T>,
      ) => callback(transactionClient),
    };

    const result = await commitStorageMutationMetadata({
      mutationId: "mutation-1",
      leaseOwner: "executor-1",
      leaseToken: 7n,
      callback: async () => ({ committedFileId: "file-1" }),
      resultJson: (value) => value,
      client: client as never,
    });

    expect(result).toEqual({ committedFileId: "file-1" });
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "metadata_committed",
          resultJson: { committedFileId: "file-1" },
        }),
      }),
    );
  });
});

describe("storage mutation operator retry", () => {
  it("allows only lease-free transient forward or cleanup retries", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });

    await expect(
      retryStorageMutationNow("mutation-1", {
        storageMutation: { updateMany },
      } as never),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "mutation-1",
        status: { in: ["retrying", "finalizing"] },
        leaseOwner: null,
      },
      data: {
        nextAttemptAt: expect.any(Date),
        lastError: null,
      },
    });
  });
});

describe("storage mutation result retention", () => {
  it("retains child results until their parent succeeds", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    await pruneSucceededStorageMutationResults(
      new Date("2026-07-01T00:00:00.000Z"),
      { storageMutation: { updateMany } } as never,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: "succeeded",
        completedAt: { lt: new Date("2026-07-01T00:00:00.000Z") },
        OR: [{ parentId: null }, { parent: { is: { status: "succeeded" } } }],
      },
      data: { resultJson: expect.anything() },
    });
  });
});
