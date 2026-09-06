import { describe, expect, it, vi } from "vitest";

import { recoverStorageMutations } from "./storage-mutation-recovery.js";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  claim: vi.fn(),
  recoverParent: vi.fn(),
}));

vi.mock("@staaash/db/storage-mutations", () => ({
  applyStorageMutationIntentMetadata: vi.fn(),
  claimStorageMutation: mocks.claim,
  listRecoverableStorageMutations: mocks.list,
  requireStorageMutationRecovery: vi.fn(),
  retryStorageMutation: vi.fn(),
}));

vi.mock("@staaash/db/storage-mutation-executor", () => ({
  executeClaimedStorageMutation: vi.fn(),
  recoverStorageMutationCleanup: vi.fn(),
  StorageMutationAmbiguityError: class extends Error {},
}));

vi.mock("./storage-mutation-parent-recovery.js", () => ({
  ParentChildRecoveryRequiredError: class extends Error {},
  recoverStorageMutationParent: mocks.recoverParent,
}));

describe("storage mutation recovery", () => {
  it("keeps move recovery bounded by the requested concurrency", async () => {
    const mutations = Array.from({ length: 5 }, (_, index) => ({
      id: `move-${index}`,
      kind: "batch_move",
      ownerUserId: `owner-${index}`,
      status: "prepared",
    }));
    let active = 0;
    let maximumActive = 0;
    mocks.list.mockResolvedValue(mutations);
    mocks.claim.mockImplementation(async ({ id }) => ({
      ...mutations.find((mutation) => mutation.id === id),
      leaseOwner: "test-worker",
      leaseToken: 1n,
    }));
    mocks.recoverParent.mockImplementation(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return true;
    });

    await expect(
      recoverStorageMutations({
        storagePaths: {
          filesRoot: "/files",
          tmpRoot: "/tmp",
          heartbeatPath: "/heartbeat",
          pendingDeleteRoot: "/pending-delete",
          uploadStagingTtlMs: 60_000,
        },
        concurrency: 2,
        take: 5,
      }),
    ).resolves.toBe(5);

    expect(maximumActive).toBe(2);
    expect(mocks.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceKeys: ["owner:owner-0"],
      }),
    );
  });
});
