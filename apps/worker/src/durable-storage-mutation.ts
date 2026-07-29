import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import type { Prisma } from "@staaash/db/client";
import {
  applyStorageMutationIntentMetadata,
  prepareStorageMutation,
  type RecoverableStorageMutationIntent,
  type StorageMetadataOperation,
  type StorageMutationEntityInput,
  type StorageMutationKind,
  type StorageMutationStepInput,
  findStorageMutation,
  findStorageMutationByIdempotencyKey,
} from "@staaash/db/storage-mutations";
import {
  assertStorageFilesystemSupported,
  claimAndExecuteStorageMutation,
} from "@staaash/db/storage-mutation-executor";

import type { WorkerStoragePaths } from "./storage-maintenance.js";

export class StorageMutationOwnedError extends Error {
  readonly mutationId: string;

  constructor(mutationId: string, cause?: unknown) {
    super("Durable storage mutation owns generated artifact.", { cause });
    this.name = "StorageMutationOwnedError";
    this.mutationId = mutationId;
  }
}

export const assertWorkerMutationMayStart = async (mutationId: string) => {
  const existing = await findStorageMutation(mutationId);
  if (!existing) return "new" as const;
  if (existing.status === "succeeded") return "succeeded" as const;
  throw new StorageMutationOwnedError(mutationId);
};

export const hashWorkerStorageRequest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    )
    .digest("hex");

export const buildArtifactPublishSteps = ({
  mutationId,
  tmpKey,
  storageKey,
  sizeBytes,
  checksum,
  oldChecksum,
}: {
  mutationId: string;
  tmpKey: string;
  storageKey: string;
  sizeBytes: bigint;
  checksum: string;
  oldChecksum: string | null;
}): StorageMutationStepInput[] => {
  if (!oldChecksum) {
    return [
      {
        action: "rename",
        sourceKey: tmpKey,
        targetKey: storageKey,
        expectedNodeType: "file",
        expectedSizeBytes: sizeBytes,
        expectedChecksum: checksum,
      },
    ];
  }
  const fileName = path.posix.basename(storageKey);
  const incomingKey = `tmp/incoming/${mutationId}/${fileName}`;
  const backupKey = `tmp/backup/${mutationId}/${fileName}`;
  return [
    {
      action: "rename",
      sourceKey: tmpKey,
      targetKey: incomingKey,
      expectedNodeType: "file",
      expectedSizeBytes: sizeBytes,
      expectedChecksum: checksum,
    },
    {
      action: "rename",
      sourceKey: storageKey,
      targetKey: backupKey,
      expectedNodeType: "file",
      expectedChecksum: oldChecksum,
    },
    {
      action: "rename",
      sourceKey: incomingKey,
      targetKey: storageKey,
      expectedNodeType: "file",
      expectedSizeBytes: sizeBytes,
      expectedChecksum: checksum,
    },
    {
      action: "delete_file",
      targetKey: backupKey,
      expectedNodeType: "file",
      expectedChecksum: oldChecksum,
    },
  ];
};

type WorkerStorageMutationArgs = {
  mutationId?: string;
  kind: StorageMutationKind;
  ownerUserId: string;
  idempotencyKey?: string;
  metadataOperations: StorageMetadataOperation[];
  steps: StorageMutationStepInput[];
  entities?: StorageMutationEntityInput[];
  storagePaths: WorkerStoragePaths;
  details?: Record<string, unknown>;
  parentId?: string | null;
  resultJson?: Prisma.InputJsonValue;
  requestHashPayload?: unknown;
  resourceKeys?: string[];
};

// Preparation resolution deliberately handles every durable ownership outcome.
// fallow-ignore-next-line complexity
const resolvePrepareFailure = async ({
  error,
  mutationId,
  idempotencyKey,
  kind,
  ownerUserId,
  requestHash,
}: Pick<
  WorkerStorageMutationArgs,
  "mutationId" | "idempotencyKey" | "kind" | "ownerUserId"
> & {
  error: unknown;
  requestHash: string;
}): Promise<never> => {
  let existing;
  try {
    existing = mutationId
      ? await findStorageMutation(mutationId)
      : idempotencyKey
        ? await findStorageMutationByIdempotencyKey(idempotencyKey)
        : null;
  } catch {
    throw new StorageMutationOwnedError(
      mutationId ?? idempotencyKey ?? "unknown-storage-mutation",
      error,
    );
  }
  if (
    existing?.kind === kind &&
    existing.ownerUserId === ownerUserId &&
    existing.requestHash === requestHash
  ) {
    throw new StorageMutationOwnedError(existing.id, error);
  }
  throw error;
};

const executePreparedMutation = async ({
  prepared,
  storagePaths,
  resultJson,
}: {
  prepared: Awaited<ReturnType<typeof prepareStorageMutation>>;
  storagePaths: WorkerStoragePaths;
  resultJson?: Prisma.InputJsonValue;
}) => {
  if (prepared.replayed) {
    if (prepared.mutation.status === "succeeded") return prepared.mutation;
    throw new StorageMutationOwnedError(prepared.mutation.id);
  }
  try {
    await claimAndExecuteStorageMutation({
      mutationId: prepared.mutation.id,
      filesRoot: storagePaths.filesRoot,
      leaseOwner: `worker:${os.hostname()}:${process.pid}:${randomUUID()}`,
      commitMetadata: (tx) =>
        applyStorageMutationIntentMetadata(tx, prepared.mutation.intentJson),
      resultJson: () => resultJson,
    });
  } catch (error) {
    throw new StorageMutationOwnedError(prepared.mutation.id, error);
  }
  return prepared.mutation;
};

export const runWorkerStorageMutation = async ({
  mutationId,
  kind,
  ownerUserId,
  idempotencyKey,
  metadataOperations,
  steps,
  entities,
  storagePaths,
  details = {},
  parentId,
  resultJson,
  requestHashPayload,
  resourceKeys,
}: WorkerStorageMutationArgs) => {
  await assertStorageFilesystemSupported(storagePaths.filesRoot);
  const intent: RecoverableStorageMutationIntent = {
    version: 1,
    metadataOperations,
    ...details,
  };
  const requestHash = hashWorkerStorageRequest(
    requestHashPayload ?? { kind, ownerUserId, intent, steps, entities },
  );
  let prepared: Awaited<ReturnType<typeof prepareStorageMutation>>;
  try {
    prepared = await prepareStorageMutation({
      id: mutationId,
      parentId,
      kind,
      ownerUserId,
      idempotencyKey,
      requestHash,
      intentJson: intent as unknown as Prisma.InputJsonValue,
      steps,
      entities,
      resourceKeys: resourceKeys ?? (parentId ? [] : [`owner:${ownerUserId}`]),
    });
  } catch (error) {
    return resolvePrepareFailure({
      error,
      mutationId,
      idempotencyKey,
      kind,
      ownerUserId,
      requestHash,
    });
  }
  return executePreparedMutation({ prepared, storagePaths, resultJson });
};
