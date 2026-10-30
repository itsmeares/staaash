import { setTimeout as sleep } from "node:timers/promises";

import {
  findStorageMutationByIdempotencyKey,
  StorageMutationConflictError,
} from "@staaash/db/storage-mutations";

const WAIT_MS = 30_000;
const POLL_MS = 200;

const isRunningElsewhere = (error: unknown) =>
  error instanceof StorageMutationConflictError &&
  ["STORAGE_MUTATION_RECOVERING", "STORAGE_MUTATION_IN_PROGRESS"].includes(
    error.code,
  );

/**
 * The worker's startup recovery can pick up a user who is being created right
 * now. The same work is then running elsewhere, so wait for it. Anything else,
 * or no result in time, stays the original error.
 */
export const runOrAwaitProvisioning = async (
  idempotencyKey: string,
  provision: () => Promise<unknown>,
  { find = findStorageMutationByIdempotencyKey, pollMs = POLL_MS } = {},
) => {
  try {
    await provision();
  } catch (error) {
    if (!isRunningElsewhere(error)) throw error;
    const deadline = Date.now() + WAIT_MS;
    while (Date.now() < deadline) {
      const mutation = await find(idempotencyKey);
      if (mutation?.status === "succeeded") return;
      await sleep(pollMs);
    }
    throw error;
  }
};
