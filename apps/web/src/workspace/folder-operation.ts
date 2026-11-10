import {
  followStorageOperation,
  isStorageOperation,
  StorageRequestError,
  storageOperationProgress,
} from "@/src/storage-mutation-submit";
import type { FolderOperationResponse } from "@/server/files/types";
import { toastManager } from "@staaash/ui/components/toast";

export async function followFolderOperation(
  start: () => Promise<unknown>,
  title: string,
) {
  const toastId = toastManager.add({
    title,
    description: "Getting items ready",
    type: "loading",
    timeout: 0,
  });
  try {
    const answer = await start();
    if (!isStorageOperation(answer)) return;
    const started = answer as FolderOperationResponse;
    const operation = await followStorageOperation(
      started,
      `/api/files/folders/operations/${encodeURIComponent(started.operationId)}`,
      (progress) =>
        toastManager.update(toastId, {
          description:
            progress.status === "queued"
              ? `Getting ${progress.totalCount.toLocaleString("en")} items ready`
              : storageOperationProgress(progress),
        }),
    );
    if (operation.status !== "succeeded") {
      const { error } = operation;
      throw new StorageRequestError(
        error?.message ?? "Storage operation failed.",
        error?.status ?? 503,
        error?.code,
        operation.operationId,
        error?.mutationKind,
      );
    }
    return operation;
  } finally {
    toastManager.close(toastId);
  }
}
