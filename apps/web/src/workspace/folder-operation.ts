import {
  followStorageOperation,
  StorageRequestError,
  storageOperationProgress,
} from "@/src/storage-mutation-submit";
import type { FolderOperationResponse } from "@/server/files/types";
import { toastManager } from "@staaash/ui/components/toast";

/**
 * A large folder change answers 202 and finishes in the background. A
 * loading toast counts its items until it settles; a failure throws like a
 * refused request.
 */
export async function followFolderOperation(
  started: FolderOperationResponse,
  title: string,
) {
  const toastId = toastManager.add({ title, type: "loading", timeout: 0 });
  try {
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
