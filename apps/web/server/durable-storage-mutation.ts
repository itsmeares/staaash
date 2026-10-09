// Web and worker executors intentionally enforce the same journal protocol.
// fallow-ignore-file code-duplication
import os from "node:os";
import { randomUUID } from "node:crypto";

import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  applyStorageMutationIntentMetadata,
  findStorageMutation,
  findStorageMutationByIdempotencyKey,
  hashStorageMutationRequest,
  prepareStorageMutation,
  prepareStorageMutationParent,
  StorageMutationConflictError,
  StorageMutationRejectedError,
  storageMutationRejectionFromResult,
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

import { assertStorageKeysFit } from "@/server/files/storage-layout";
import { getStorageRoot } from "@/server/storage";

import {
  StorageAdmissionBusyError,
  StorageTransactionUnavailableError,
  waitForStorageAdmission,
} from "@staaash/db/storage-transactions";

const STORAGE_PROTOCOL_VERSION = 2;
class UncommittedStoragePreparationError extends Error {
  constructor(readonly original: StorageTransactionUnavailableError) {
    super(original.message, { cause: original });
  }
}
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

const assertStorageMutationMayStart = async () => {
  await assertStorageProtocolReady();
  await assertStorageFilesystemSupported(getStorageRoot());
};

export const hashDurableStorageRequest = (value: unknown) =>
  hashStorageMutationRequest(value);

export type DurableStorageMutationInput = {
  signal?: AbortSignal;
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
  /** Quota bytes held from prepare until metadata commit or abort. */
  reservedBytes?: bigint | null;
};

const mutationStateConflict = (mutation: {
  id: string;
  status: string;
  resultJson?: unknown;
}) =>
  mutation.status === "aborted"
    ? storageMutationRejectionFromResult(mutation.resultJson)
    : new StorageMutationConflictError(
        mutation.status === "recovery_required"
          ? "STORAGE_RECOVERY_REQUIRED"
          : [
                "running",
                "retrying",
                "metadata_committed",
                "finalizing",
              ].includes(mutation.status)
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
  if (
    error instanceof StorageTransactionUnavailableError ||
    (matchesRequest && existing.status !== "succeeded")
  ) {
    console.warn("[storage] Durable mutation preparation interrupted.", {
      mutationId: existing?.id ?? durableMutationId,
      kind: input.kind,
      status: existing?.status ?? "unknown",
      error,
    });
  }
  if (matchesRequest) {
    if (existing.status === "succeeded" || existing.status === "prepared")
      return existing;
    throw mutationStateConflict(existing);
  }
  if (existing && input.idempotencyKey) {
    throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
  }
  if (
    !existing &&
    error instanceof StorageMutationConflictError &&
    error.code === "STORAGE_MUTATION_IN_PROGRESS"
  ) {
    throw new StorageAdmissionBusyError();
  }
  if (!existing && error instanceof StorageTransactionUnavailableError) {
    throw new UncommittedStoragePreparationError(error);
  }
  throw error;
};

const resolveInterruptedExecution = async (mutationId: string) => {
  let current: Awaited<ReturnType<typeof findStorageMutation>> = null;
  try {
    current = await findStorageMutation(mutationId);
  } catch {
    // An unavailable journal lookup leaves the execution outcome unknown.
  }
  if (current?.status === "succeeded") return current;
  if (current) throw mutationStateConflict(current);
  throw new StorageMutationConflictError(
    "STORAGE_MUTATION_RECOVERING",
    mutationId,
  );
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
    if (error instanceof StorageMutationRejectedError) throw error;
    console.warn("[storage] Durable mutation execution interrupted.", {
      mutationId: mutation.id,
      kind: mutation.kind,
      error,
    });
    return resolveInterruptedExecution(mutation.id);
  }
  return (await findStorageMutation(mutation.id)) ?? mutation;
};

const prepareDurableStorageMutation = async (
  input: DurableStorageMutationInput,
  plan: ReturnType<typeof buildDurableMutationPlan>,
  deadline: number,
) => {
  const { intent, requestHash, durableMutationId } = plan;
  try {
    return await prepareStorageMutation(
      {
        id: durableMutationId,
        kind: input.kind,
        ownerUserId: input.ownerUserId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        intentJson: intent as unknown as Prisma.InputJsonValue,
        initialResultJson: input.resultJson,
        // Without explicit keys, the journal locks the step paths.
        resourceKeys: input.resourceKeys ?? (input.parentId ? [] : undefined),
        reservedBytes: input.reservedBytes,
        steps: input.steps,
        entities: input.entities,
        uploadSessionId: input.uploadSessionId,
        parentId: input.parentId,
      },
      { deadline, signal: input.signal },
    );
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

export const findDurableStorageMutationReplay = async (
  input: {
    idempotencyKey: string;
    kind: StorageMutationKind;
    ownerUserId: string;
    requestHash: string;
  },
  options: { allowInProgress?: boolean } = {},
) => {
  const existing = await findStorageMutationByIdempotencyKey(
    input.idempotencyKey,
  );
  if (!existing) return null;
  if (
    existing.ownerUserId !== input.ownerUserId ||
    existing.kind !== input.kind ||
    existing.requestHash !== input.requestHash
  ) {
    throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
  }
  if (existing.status !== "succeeded" && !options.allowInProgress) {
    throw mutationStateConflict(existing);
  }
  return existing;
};

// Collect every new storage path this mutation will create so impossible paths
// fail as client errors before any durable ownership is taken.
const plannedStorageKeys = (input: DurableStorageMutationInput) => [
  ...input.steps.flatMap((step) => (step.targetKey ? [step.targetKey] : [])),
  ...input.metadataOperations.flatMap((operation) => {
    const data =
      operation.action === "create_file" || operation.action === "update"
        ? (operation.data as { storageKey?: unknown })
        : null;
    return typeof data?.storageKey === "string" ? [data.storageKey] : [];
  }),
];

const replayExistingIdempotentMutation = async (
  input: DurableStorageMutationInput,
) => {
  if (!input.idempotencyKey) return null;
  const { requestHash } = buildDurableMutationPlan(input);
  return findDurableStorageMutationReplay({
    kind: input.kind,
    ownerUserId: input.ownerUserId,
    idempotencyKey: input.idempotencyKey,
    requestHash,
  });
};

export const runDurableStorageMutation = async (
  input: DurableStorageMutationInput,
) => {
  const replay = await replayExistingIdempotentMutation(input);
  if (replay) return replay;
  assertStorageKeysFit(plannedStorageKeys(input));
  await assertStorageMutationMayStart();
  const plan = buildDurableMutationPlan(input);
  let retriedUncommittedPreparation = false;
  const { mutation, replayed } = await waitForStorageAdmission(
    async (deadline) => {
      try {
        return await prepareDurableStorageMutation(input, plan, deadline);
      } catch (error) {
        if (!(error instanceof UncommittedStoragePreparationError)) throw error;
        if (retriedUncommittedPreparation) throw error.original;
        // A primary lookup found no journal; the same ID protects a late commit too.
        retriedUncommittedPreparation = true;
        try {
          return await prepareDurableStorageMutation(
            input,
            plan,
            Date.now() + 5_000,
          );
        } catch (retryError) {
          throw retryError instanceof UncommittedStoragePreparationError
            ? retryError.original
            : retryError;
        }
      }
    },
    { signal: input.signal, ownerUserId: input.ownerUserId },
  );
  if (!replayed) {
    return executePreparedMutation({
      mutation,
      resultJson: input.resultJson,
    });
  }
  if (mutation.status === "prepared") {
    return executePreparedMutation({
      mutation,
      resultJson: mutation.resultJson ?? undefined,
    });
  }
  if (mutation.status === "succeeded") return mutation;
  throw mutationStateConflict(mutation);
};

export const prepareDurableStorageMutationParent = async (
  input: Parameters<typeof prepareStorageMutationParent>[0],
  options: { allowInProgress?: boolean } = {},
) => {
  const existing = await findDurableStorageMutationReplay(input, options);
  if (existing) return { mutation: existing, replayed: true };
  await assertStorageMutationMayStart();
  const parentInput = { ...input, id: randomUUID() };
  return waitForStorageAdmission(
    (deadline) => prepareStorageMutationParent(parentInput, { deadline }),
    {
      ownerUserId: input.ownerUserId,
      retryable: (error) =>
        error instanceof StorageAdmissionBusyError ||
        (error instanceof StorageMutationConflictError &&
          error.code === "STORAGE_MUTATION_IN_PROGRESS"),
    },
  );
};
