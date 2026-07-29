import {
  findBlockingStorageMutationForEntity,
  listBlockingStorageMutationsForEntities,
} from "@staaash/db/storage-mutations";

export type StorageMutationState = {
  id: string;
  kind: string;
  status: string;
};

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
  const result = new Map(direct.map((row) => [row.entityId, row.mutation]));
  await Promise.all(
    entityIds
      .filter((entityId) => !result.has(entityId))
      .map(async (entityId) => {
        const row = await findBlockingStorageMutationForEntity({
          entityType,
          entityId,
        });
        if (row) result.set(entityId, row.mutation);
      }),
  );
  return result;
};
