import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "./client";
import { prepareStorageMutation } from "./storage-mutations";
import {
  StorageAdmissionBusyError,
  StorageTransactionUnavailableError,
} from "./storage-transactions";

const input: Parameters<typeof prepareStorageMutation>[0] = {
  id: "mutation-1",
  kind: "upload_create",
  ownerUserId: "owner-1",
  resourceKeys: [],
  intentJson: { version: 1, metadataOperations: [] },
  steps: [
    { action: "mkdir", targetKey: "files/owner-1" },
    {
      action: "rename",
      sourceKey: "tmp/staged",
      targetKey: "files/owner-1/new.txt",
      expectedSizeBytes: 5n,
      expectedChecksum: "checksum",
    },
  ],
  entities: [
    {
      entityType: "file",
      entityId: "file-1",
      preRevision: -1,
      postRevision: 0,
      beforeJson: null,
      afterJson: { name: "new.txt" },
    },
  ],
};

const fixture = () => {
  const mutation = { id: input.id, status: "prepared" };
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ acquired: true }]),
    storageMutation: {
      create: vi.fn().mockResolvedValue({ id: input.id }),
      update: vi.fn().mockResolvedValue(mutation),
      findUniqueOrThrow: vi.fn().mockResolvedValue(mutation),
    },
    storageMutationStep: {
      createMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    storageMutationEntity: {
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    storageMutationResource: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    file: { findMany: vi.fn().mockResolvedValue([]) },
    folder: { findMany: vi.fn().mockResolvedValue([]) },
    mediaDerivative: { findMany: vi.fn().mockResolvedValue([]) },
    zipArchive: { findMany: vi.fn().mockResolvedValue([]) },
  };
  const client = {
    $transaction: async <T>(
      callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ) => callback(tx as unknown as Prisma.TransactionClient),
  };
  return { tx, client, mutation };
};

// Deferred writes let the tests detect parallel or nested dependent inserts.
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

describe("storage mutation journal admission", () => {
  beforeEach(() => vi.clearAllMocks());

  it("awaits the journal parent and steps before inserting entities and marking prepared", async () => {
    const { tx, client, mutation } = fixture();
    const parent = deferred<{ id: string }>();
    const steps = deferred<{ count: number }>();
    const parentStarted = deferred<void>();
    const stepsStarted = deferred<void>();
    tx.storageMutation.create.mockImplementation(() => {
      parentStarted.resolve();
      return parent.promise;
    });
    tx.storageMutationStep.createMany.mockImplementation(() => {
      stepsStarted.resolve();
      return steps.promise;
    });
    const pending = prepareStorageMutation(input, { client });
    await parentStarted.promise;
    expect(tx.storageMutationStep.createMany).not.toHaveBeenCalled();
    expect(tx.storageMutationEntity.createMany).not.toHaveBeenCalled();
    parent.resolve({ id: "mutation-1" });
    await stepsStarted.promise;
    expect(tx.storageMutationEntity.createMany).not.toHaveBeenCalled();
    expect(tx.storageMutation.update).not.toHaveBeenCalled();
    steps.resolve({ count: 2 });
    await expect(pending).resolves.toEqual({ mutation, replayed: false });
    expect(tx.storageMutationStep.createMany).toHaveBeenCalledWith({
      data: input.steps.map((step, ordinal) => ({
        ...step,
        ordinal,
        mutationId: "mutation-1",
      })),
    });
    const { Prisma } = await import("./client");
    expect(tx.storageMutationEntity.createMany).toHaveBeenCalledWith({
      data: [
        {
          ...input.entities![0],
          mutationId: "mutation-1",
          beforeJson: Prisma.JsonNull,
        },
      ],
    });
    expect(tx.storageMutation.create.mock.calls[0][0].data).not.toHaveProperty(
      "steps",
    );
    expect(tx.storageMutation.create.mock.calls[0][0].data).not.toHaveProperty(
      "entities",
    );
  });

  it.each(["parent", "steps", "entities"])(
    "stops dependent writes after the %s insert fails",
    async (stage) => {
      const { tx, client } = fixture();
      const failure = { code: "P2028" };
      if (stage === "parent")
        tx.storageMutation.create.mockRejectedValue(failure);
      if (stage === "steps")
        tx.storageMutationStep.createMany.mockRejectedValue(failure);
      if (stage === "entities")
        tx.storageMutationEntity.createMany.mockRejectedValue(failure);
      await expect(
        prepareStorageMutation(input, { client }),
      ).rejects.toBeInstanceOf(StorageTransactionUnavailableError);
      expect(tx.storageMutationStep.createMany).toHaveBeenCalledTimes(
        stage === "parent" ? 0 : 1,
      );
      expect(tx.storageMutationEntity.createMany).toHaveBeenCalledTimes(
        stage === "entities" ? 1 : 0,
      );
      expect(tx.storageMutation.update).not.toHaveBeenCalled();
      expect(tx.storageMutationResource.create).not.toHaveBeenCalled();
    },
  );

  it("prepares an empty journal without child inserts", async () => {
    const { tx, client, mutation } = fixture();
    await expect(
      prepareStorageMutation({ ...input, steps: [], entities: [] }, { client }),
    ).resolves.toEqual({ mutation, replayed: false });
    expect(tx.storageMutationStep.createMany).not.toHaveBeenCalled();
    expect(tx.storageMutationEntity.createMany).not.toHaveBeenCalled();
  });

  it.each(["storage:global-recovery", "owner:owner-1/files/new.txt"])(
    "rejects unavailable advisory admission for %s before journaling",
    async (resourceKey) => {
      const { tx, client } = fixture();
      tx.$queryRaw.mockResolvedValue([{ acquired: false }]);
      await expect(
        prepareStorageMutation(
          { ...input, resourceKeys: [resourceKey] },
          { client },
        ),
      ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
      expect(tx.storageMutation.create).not.toHaveBeenCalled();
      expect(tx.storageMutationResource.create).not.toHaveBeenCalled();
    },
  );
});
