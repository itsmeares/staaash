import { randomClientId } from "@/lib/client-id";

const storageMutationKeys = new Map<
  string,
  { key: string; operationId?: string }
>();

/** A storage change the server answered with an error. */
export class StorageRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /** The journal mutation that holds the item, when the server names it. */
    readonly mutationId?: string,
    readonly mutationKind?: string,
  ) {
    super(message);
    this.name = "StorageRequestError";
  }
}

/**
 * A storage change that keeps one Idempotency-Key until it succeeds, so a
 * retry after a lost response replays instead of repeating.
 */
export const submitStorageMutationPost = async ({
  action,
  json,
  logicalAction,
  headers,
}: {
  action: string;
  json?: Record<string, unknown>;
  logicalAction: string;
  headers?: Record<string, string>;
}) => {
  const request = storageMutationKeys.get(logicalAction) ?? {
    key: randomClientId(),
  };
  storageMutationKeys.set(logicalAction, request);
  const response = await fetch(action, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": request.key,
      ...headers,
    },
    body: JSON.stringify(json ?? {}),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      details?: { mutationKind?: unknown };
    };
    const kind = body.details?.mutationKind;
    throw new StorageRequestError(
      body.error ?? "Storage operation failed.",
      response.status,
      body.code,
      response.headers.get("X-Storage-Mutation-Id") ?? undefined,
      typeof kind === "string" ? kind : undefined,
    );
  }
  const answer: unknown = await response.json().catch(() => null);
  if (response.status === 202) {
    if (!isStorageOperation(answer)) {
      throw new Error(
        "Staaash couldn't confirm this change. Try again to check its progress.",
      );
    }
    request.operationId = answer.operationId;
  } else if (storageMutationKeys.get(logicalAction) === request) {
    storageMutationKeys.delete(logicalAction);
  }
  return answer;
};

/**
 * Drops the kept key so the next request for this change starts a new
 * mutation. Call it once a retry should no longer replay the old one.
 */
export const forgetStorageMutationKey = (logicalAction: string) =>
  storageMutationKeys.delete(logicalAction);

type StorageOperation = {
  operationId: string;
  status: string;
  totalCount: number;
  doneCount: number;
};

export const isStorageOperation = (
  value: unknown,
): value is StorageOperation => {
  if (!value || typeof value !== "object") return false;
  const operation = value as Partial<StorageOperation>;
  return (
    typeof operation.operationId === "string" &&
    operation.operationId.length > 0 &&
    ["queued", "running", "succeeded", "failed", "recovery_required"].includes(
      operation.status ?? "",
    ) &&
    typeof operation.totalCount === "number" &&
    Number.isInteger(operation.totalCount) &&
    operation.totalCount >= 0 &&
    typeof operation.doneCount === "number" &&
    Number.isInteger(operation.doneCount) &&
    operation.doneCount >= 0
  );
};

const OPERATION_POLL_MS = 1_000;
const OPERATION_MAX_MISSED_POLLS = 30;

/**
 * Polls a background storage change until it leaves queued and running.
 * The server keeps going if this page closes, so a dropped poll is not a
 * failure; only a run of them, or a change the server no longer knows, is.
 */
export const followStorageOperation = async <T extends StorageOperation>(
  started: T,
  statusUrl: string,
  onProgress?: (operation: T) => void,
) => {
  let operation = started;
  let missed = 0;
  while (operation.status === "queued" || operation.status === "running") {
    onProgress?.(operation);
    await new Promise((resolve) => setTimeout(resolve, OPERATION_POLL_MS));
    const poll = await fetch(statusUrl, {
      headers: { Accept: "application/json" },
    }).catch(() => null);
    const value: unknown = poll?.ok
      ? await poll.json().catch(() => null)
      : null;
    if (isStorageOperation(value)) {
      operation = value as T;
      missed = 0;
    } else if (poll?.status === 404 || ++missed >= OPERATION_MAX_MISSED_POLLS) {
      throw new Error("Staaash lost track of it. Refresh to see where it is.");
    }
  }
  for (const [action, request] of storageMutationKeys) {
    if (request.operationId === operation.operationId)
      storageMutationKeys.delete(action);
  }
  return operation;
};

/** "12 of 200 items", once the server knows how many there are. */
export const storageOperationProgress = ({
  doneCount,
  totalCount,
}: StorageOperation) =>
  totalCount > 0
    ? `${doneCount.toLocaleString("en")} of ${totalCount.toLocaleString("en")} ${totalCount === 1 ? "item" : "items"}`
    : undefined;
