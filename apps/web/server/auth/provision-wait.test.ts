import { expect, it } from "vite-plus/test";

import { StorageMutationConflictError } from "@staaash/db/storage-mutations";

import { runOrAwaitProvisioning } from "./provision-wait";

const busy = () =>
  Promise.reject(
    new StorageMutationConflictError("STORAGE_MUTATION_RECOVERING"),
  );

it("waits for the other process when it is doing the same work", async () => {
  const statuses = ["running", "finalizing", "succeeded"];
  await expect(
    runOrAwaitProvisioning("key", busy, {
      find: (async () => ({ status: statuses.shift() })) as never,
      pollMs: 1,
    }),
  ).resolves.toBeUndefined();
  expect(statuses).toEqual([]);
});

it("does not hide any other error", async () => {
  const other = new StorageMutationConflictError("STORAGE_RECOVERY_REQUIRED");
  await expect(
    runOrAwaitProvisioning("key", () => Promise.reject(other), {
      find: (async () => {
        throw new Error("should not look");
      }) as never,
    }),
  ).rejects.toBe(other);
});
