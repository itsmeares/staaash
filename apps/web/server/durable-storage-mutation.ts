// Web and worker executors intentionally enforce the same journal protocol.
// fallow-ignore-file code-duplication
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";

import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  applyStorageMutationIntentMetadata,
  findStorageMutation,
  findStorageMutationByIdempotencyKey,
  prepareStorageMutation,
  StorageMutationConflictError,
  type RecoverableStorageMutationIntent,
  type StorageMetadataOperation,
  type StorageMutationEntityInput,
  type StorageMutationKind,
  type StorageMutationStepInput,
} from "@staaash/db/storage-mutations";
import {
  assertStorageFilesystemSupported,
  claimAndExecuteStorageMutation,
} from "@staaash/db/storage-mutation-executor";

import { getStorageRoot } from "@/server/storage";

const STORAGE_PROTOCOL_VERSION = 2;

export class StorageProtocolNotReadyError extends Error {
  readonly code = "STORAGE_MUTATION_RECOVERING";
  readonly status = 503;

  constructor() {
    super("Storage mutations are unavailable until storage recovery finishes.");
    this.name = "StorageProtocolNotReadyError";
  }
}

export const assertStorageProtocolReady = async () => {
  const instance = await getPrisma().instance.findUnique({
    where: { id: "singleton" },
    select: { storageProtocolVersion: true },
  });
  if (instance?.storageProtocolVersion !== STORAGE_PROTOCOL_VERSION) {
    throw new StorageProtocolNotReadyError();
  }
};

export const assertStorageMutationMayStart = async () => {
  await assertStorageProtocolReady();
  await assertStorageFilesystemSupported(getStorageRoot());
};

export const hashDurableStorageRequest = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        typeof item === "bigint" ? item.toString() : item,
      ),
    )
    .digest("hex");

export type DurableStorageMutationInput = {
  kind: StorageMutationKind;
  ownerUserId: string;
  idempotencyKey?: string | null;
  metadataOperations: StorageMetadataOperation[];
  steps: StorageMutationStepInput[];
  entities?: StorageMutationEntityInput[];
  resourceKeys?: string[];
  details?: Record<string, unknown>;
  uploadSessionId?: string | null;
  mutationId?: string;
  requestHashPayload?: unknown;
  resultJson?: Prisma.InputJsonValue;
  parentId?: string | null;
};

const mutationStateConflict = (mutation: { id: string; status: string }) =>
  new StorageMutationConflictError(
    mutation.status === "recovery_required"
      ? "STORAGE_RECOVERY_REQUIRED"
      : ["running", "retrying", "metadata_committed", "finalizing"].includes(
            mutation.status,
          )
        ? "STORAGE_MUTATION_RECOVERING"
        : "STORAGE_MUTATION_IN_PROGRESS",
    mutation.id,
  );

const buildDurableMutationPlan = (input: DurableStorageMutationInput) => {
  const intent: RecoverableStorageMutationIntent = {
    version: 1,
    metadataOperations: input.metadataOperations,
    ...(input.details ?? {}),
  };
  const requestHash = hashDurableStorageRequest(
    input.requestHashPayload ?? {
      kind: input.kind,
      ownerUserId: input.ownerUserId,
      intent,
      steps: input.steps,
      entities: input.entities,
    },
  );
  return {
    intent,
    requestHash,
    durableMutationId: input.mutationId ?? randomUUID(),
  };
};

const findConflictingMutation = async (
  durableMutationId: string,
  idempotencyKey?: string | null,
) => {
  try {
    return idempotencyKey
      ? await findStorageMutationByIdempotencyKey(idempotencyKey)
      : await findStorageMutation(durableMutationId);
  } catch {
    throw new StorageMutationConflictError(
      "STORAGE_MUTATION_RECOVERING",
      durableMutationId,
    );
  }
};

// Preparation resolution deliberately handles every durable ownership outcome.
// fallow-ignore-next-line complexity
const resolveDurablePreparationFailure = async ({
  error,
  input,
  durableMutationId,
  requestHash,
}: {
  error: unknown;
  input: DurableStorageMutationInput;
  durableMutationId: string;
  requestHash: string;
}) => {
  const existing = await findConflictingMutation(
    durableMutationId,
    input.idempotencyKey,
  );
  const matchesRequest =
    existing?.kind === input.kind &&
    existing.ownerUserId === input.ownerUserId &&
    existing.requestHash === requestHash;
  if (matchesRequest) {
    if (existing.status === "succeeded") return existing;
    throw mutationStateConflict(existing);
  }
  if (existing && input.idempotencyKey) {
    throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
  }
  throw error;
};

const executePreparedMutation = async ({
  mutation,
  resultJson,
}: {
  mutation: Awaited<ReturnType<typeof prepareStorageMutation>>["mutation"];
  resultJson?: Prisma.InputJsonValue;
}) => {
  try {
    await claimAndExecuteStorageMutation({
      mutationId: mutation.id,
      filesRoot: getStorageRoot(),
      leaseOwner: `web:${os.hostname()}:${process.pid}:${randomUUID()}`,
      commitMetadata: (tx) =>
        applyStorageMutationIntentMetadata(tx, mutation.intentJson),
      resultJson: () => resultJson,
    });
  } catch (error) {
    try {
      const current = await findStorageMutation(mutation.id);
      if (current) throw mutationStateConflict(current);
    } catch (lookupError) {
      if (lookupError instanceof StorageMutationConflictError) {
        throw lookupError;
      }
    }
    throw new StorageMutationConflictError(
      "STORAGE_MUTATION_RECOVERING",
      mutation.id,
    );
  }
  return (await findStorageMutation(mutation.id)) ?? mutation;
};

const prepareDurableStorageMutation = async (
  input: DurableStorageMutationInput,
) => {
  const { intent, requestHash, durableMutationId } =
    buildDurableMutationPlan(input);
  try {
    return await prepareStorageMutation({
      id: durableMutationId,
      kind: input.kind,
      ownerUserId: input.ownerUserId,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      intentJson: intent as unknown as Prisma.InputJsonValue,
      resourceKeys:
        input.resourceKeys ??
        (input.parentId ? [] : [`owner:${input.ownerUserId}`]),
      steps: input.steps,
      entities: input.entities,
      uploadSessionId: input.uploadSessionId,
      parentId: input.parentId,
    });
  } catch (error) {
    const existing = await resolveDurablePreparationFailure({
      error,
      input,
      durableMutationId,
      requestHash,
    });
    return { mutation: existing, replayed: true };
  }
};

export const runDurableStorageMutation = async (
  input: DurableStorageMutationInput,
) => {
  await assertStorageMutationMayStart();
  const { mutation, replayed } = await prepareDurableStorageMutation(input);
  if (!replayed) {
    return executePreparedMutation({
      mutation,
      resultJson: input.resultJson,
    });
  }
  if (mutation.status === "succeeded") return mutation;
  throw mutationStateConflict(mutation);
};
