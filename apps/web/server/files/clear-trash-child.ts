import { StorageMutationConflictError } from "@staaash/db/storage-mutations";

export const assertClearTrashChildReplayIdentity = ({
  child,
  parentId,
  ownerUserId,
  expectedKind,
  requestHash,
}: {
  child: {
    parentId: string | null;
    kind: string;
    ownerUserId: string;
    requestHash: string | null;
  };
  parentId: string;
  ownerUserId: string;
  expectedKind: "file_purge" | "folder_purge";
  requestHash: string;
}) => {
  if (
    child.parentId !== parentId ||
    child.kind !== expectedKind ||
    child.ownerUserId !== ownerUserId ||
    child.requestHash !== requestHash
  ) {
    throw new StorageMutationConflictError("STORAGE_IDEMPOTENCY_KEY_REUSED");
  }
};
