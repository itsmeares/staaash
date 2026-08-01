import os from "node:os";

import {
  applyStorageMutationIntentMetadata,
  listRecoverableStorageMutations,
  requireStorageMutationRecovery,
  retryStorageMutation,
  type StorageMutationRecord,
} from "@staaash/db/storage-mutations";
import {
  executeClaimedStorageMutation,
  recoverStorageMutationCleanup,
  StorageMutationAmbiguityError,
} from "@staaash/db/storage-mutation-executor";
import { claimStorageMutation } from "@staaash/db/storage-mutations";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import {
  ParentChildRecoveryRequiredError,
  recoverStorageMutationParent,
} from "./storage-mutation-parent-recovery.js";

const workerLeaseOwner = () =>
  `storage-recovery:${os.hostname()}:${process.pid}`;

const isParentMutation = (kind: string) =>
  kind === "batch_move" || kind === "clear_trash" || kind === "trash_retention";

const classifyParentRecoveryError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Parent recovery failed.";
  const deterministic =
    error instanceof ParentChildRecoveryRequiredError ||
    /invalid durable|identity mismatch|escaped|ambiguous|identity changed|cycle|unsupported storage mutation parent/i.test(
      message,
    );
  return { message, deterministic };
};

const recoverParentMutation = async ({
  mutation,
  storagePaths,
  leaseOwner,
}: {
  mutation: Awaited<ReturnType<typeof claimStorageMutation>>;
  storagePaths: WorkerStoragePaths;
  leaseOwner: string;
}) => {
  if (!mutation) return false;
  try {
    return await recoverStorageMutationParent({
      parent: mutation,
      leaseOwner,
      storagePaths,
    });
  } catch (error) {
    const { message, deterministic } = classifyParentRecoveryError(error);
    const persistFailure = deterministic
      ? requireStorageMutationRecovery
      : retryStorageMutation;
    await persistFailure({
      mutationId: mutation.id,
      leaseOwner,
      leaseToken: mutation.leaseToken,
      error: message,
    }).catch(() => undefined);
    return false;
  }
};

const recoverForwardMutation = async ({
  mutation,
  storagePaths,
  leaseOwner,
}: {
  mutation: StorageMutationRecord;
  storagePaths: WorkerStoragePaths;
  leaseOwner: string;
}) => {
  const claimed = await claimStorageMutation({
    id: mutation.id,
    leaseOwner,
  });
  if (!claimed) return false;

  try {
    if (isParentMutation(claimed.kind)) {
      return recoverParentMutation({
        mutation: claimed,
        storagePaths,
        leaseOwner,
      });
    }
    await executeClaimedStorageMutation({
      mutation: claimed,
      filesRoot: storagePaths.filesRoot,
      leaseOwner,
      leaseToken: claimed.leaseToken,
      commitMetadata: (tx) =>
        applyStorageMutationIntentMetadata(tx, claimed.intentJson),
    });
    return true;
  } catch (error) {
    if (error instanceof StorageMutationAmbiguityError) return false;
    throw error;
  }
};

const isCleanupMutation = (mutation: StorageMutationRecord) =>
  mutation.status === "metadata_committed" || mutation.status === "finalizing";

const recoverCleanupMutation = async ({
  mutation,
  storagePaths,
  leaseOwner,
}: {
  mutation: StorageMutationRecord;
  storagePaths: WorkerStoragePaths;
  leaseOwner: string;
}) => {
  try {
    return await recoverStorageMutationCleanup({
      mutationId: mutation.id,
      filesRoot: storagePaths.filesRoot,
      leaseOwner,
    });
  } catch (error) {
    console.warn("[worker] Storage mutation cleanup deferred.", {
      mutationId: mutation.id,
      error: error instanceof Error ? error.message : "Unknown error.",
    });
    return false;
  }
};

const recoverMutation = async ({
  mutation,
  storagePaths,
  leaseOwner,
}: {
  mutation: StorageMutationRecord;
  storagePaths: WorkerStoragePaths;
  leaseOwner: string;
}) => {
  if (isCleanupMutation(mutation)) {
    return recoverCleanupMutation({ mutation, storagePaths, leaseOwner });
  }
  try {
    return await recoverForwardMutation({ mutation, storagePaths, leaseOwner });
  } catch (error) {
    // Executor already persisted retry vs recovery-required classification.
    // One failed mutation must not stop recovery of unrelated owners.
    console.warn("[worker] Storage mutation recovery deferred.", {
      mutationId: mutation.id,
      error: error instanceof Error ? error.message : "Unknown error.",
    });
    return false;
  }
};

export const recoverStorageMutations = async ({
  storagePaths,
  leaseOwner = workerLeaseOwner(),
}: {
  storagePaths: WorkerStoragePaths;
  leaseOwner?: string;
}) => {
  const mutations = await listRecoverableStorageMutations();
  let recovered = 0;

  for (const mutation of mutations) {
    if (await recoverMutation({ mutation, storagePaths, leaseOwner })) {
      recovered += 1;
    }
  }

  return recovered;
};
