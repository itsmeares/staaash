import { Prisma } from "@staaash/db/client";
import {
  findBlockingStorageMutationForEntity,
  listBlockingStorageMutationsForEntities,
} from "@staaash/db/storage-mutations";

export type StorageMutationState = {
  id: string;
  kind: string;
  status: string;
};

export const storageReadPredicate = (
  userId: string,
  id: Prisma.Sql,
  kind: Prisma.Sql,
) => Prisma.sql`
  NOT EXISTS (
    SELECT 1 FROM "StorageMutationEntity" entity JOIN "StorageMutation" mutation ON mutation.id = entity."mutationId"
    WHERE entity."entityId" = ${id} AND entity."entityType" = ${kind}
      AND mutation.status IN ('prepared', 'running', 'retrying', 'metadata_committed', 'finalizing', 'recovery_required')
  ) AND NOT EXISTS (
    SELECT 1 FROM "StorageMutation" mutation WHERE mutation.kind = 'legacy_recovery' AND mutation.status = 'recovery_required'
      AND (mutation."ownerUserId" = ${userId} OR EXISTS (
        SELECT 1 FROM "StorageMutationResource" resource WHERE resource."mutationId" = mutation.id
          AND resource."resourceKey" = 'storage:global-recovery' AND resource."releasedAt" IS NULL
      ))
  )`;

export type StorageMutationEntityType =
  | "file"
  | "folder"
  | "derivative"
  | "archive"
  | "upload_session"
  | "trash_entry";

export class StorageEntityUnavailableError extends Error {
  readonly code:
    | "STORAGE_MUTATION_IN_PROGRESS"
    | "STORAGE_MUTATION_RECOVERING"
    | "STORAGE_RECOVERY_REQUIRED";
  readonly status = 503;
  readonly mutationId: string;

  constructor(state: StorageMutationState) {
    const recovering = [
      "prepared",
      "running",
      "retrying",
      "metadata_committed",
      "finalizing",
    ].includes(state.status);
    super(
      state.status === "recovery_required"
        ? "Storage recovery is required before this item can be read."
        : recovering
          ? "Storage operation is being recovered."
          : "Storage operation is in progress.",
    );
    this.name = "StorageEntityUnavailableError";
    this.code =
      state.status === "recovery_required"
        ? "STORAGE_RECOVERY_REQUIRED"
        : recovering
          ? "STORAGE_MUTATION_RECOVERING"
          : "STORAGE_MUTATION_IN_PROGRESS";
    this.mutationId = state.id;
  }
}

export const createStorageEntityUnavailableResponse = (
  error: StorageEntityUnavailableError,
) =>
  Response.json(
    { error: error.message, code: error.code },
    {
      status: error.status,
      headers: { "X-Storage-Mutation-Id": error.mutationId },
    },
  );

const getStorageMutationState = async (
  entityType: StorageMutationEntityType,
  entityId: string,
): Promise<StorageMutationState | null> => {
  const row = await findBlockingStorageMutationForEntity({
    entityType,
    entityId,
  });
  return row?.mutation ?? null;
};

export const assertStorageEntityReadable = async (
  entityType: StorageMutationEntityType,
  entityId: string,
) => {
  const state = await getStorageMutationState(entityType, entityId);
  if (state) throw new StorageEntityUnavailableError(state);
};

export const getStorageMutationStateMap = async (
  entityType: StorageMutationEntityType,
  entityIds: string[],
) => {
  const direct = await listBlockingStorageMutationsForEntities({
    entityType,
    entityIds,
  });
  return new Map(direct.map((row) => [row.entityId, row.mutation]));
};
