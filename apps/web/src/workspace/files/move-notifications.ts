import { toast } from "@staaash/ui/components/toast";

import type { BatchMoveOperationResponse } from "@/server/files/types";
import { isBatchMoveOperationResponse } from "./files-move";

const DISMISSAL_PREFIX = "staaash:move-dismissal:";
const RESULT_WINDOW_MS = 24 * 60 * 60 * 1_000;

const isDismissed = (key: string) => {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const storedKey = localStorage.key(index);
      if (!storedKey?.startsWith(DISMISSAL_PREFIX)) continue;
      const expiresAt = Number(localStorage.getItem(storedKey));
      if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
        localStorage.removeItem(storedKey);
      }
    }
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
};

export function showMoveFailure(
  failure: string | Error,
  {
    operationId,
    status = "succeeded",
    retry,
  }: {
    operationId?: string | null;
    status?: BatchMoveOperationResponse["status"] | "failed";
    retry?: () => void;
  } = {},
) {
  if (failure instanceof Error && isBatchMoveOperationResponse(failure.cause)) {
    ({ operationId, status } = failure.cause);
  }
  // Move IDs are unique across accounts. No file names or error text is saved.
  const key = operationId
    ? `${DISMISSAL_PREFIX}${operationId}:${status}`
    : undefined;
  if (key && isDismissed(key)) return;

  toast.error(failure instanceof Error ? failure.message : failure, {
    id: key,
    retry,
    onClose: key
      ? () => {
          try {
            localStorage.setItem(
              key,
              String(
                status === "recovery_required"
                  ? Infinity
                  : Date.now() + RESULT_WINDOW_MS,
              ),
            );
          } catch {
            // Closing still works when browser storage is unavailable.
          }
        }
      : undefined,
  });
}
