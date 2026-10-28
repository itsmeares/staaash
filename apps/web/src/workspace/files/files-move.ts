import { randomClientId } from "@/lib/client-id";
import type {
  BatchMoveItem,
  BatchMoveOperationResponse,
  BatchMoveResponse,
} from "@/server/files/types";

export const getMoveItemsForInteraction = ({
  allItems,
  selectedIds,
  target,
}: {
  allItems: BatchMoveItem[];
  selectedIds: ReadonlySet<string>;
  target: BatchMoveItem;
}): BatchMoveItem[] =>
  selectedIds.has(target.id) && selectedIds.size > 1
    ? allItems.filter((item) => selectedIds.has(item.id))
    : [target];

export const getStorageMutationItemIds = ({
  childFolders,
  files,
}: {
  childFolders: ReadonlyArray<{
    id: string;
    storageMutation?: unknown | null;
  }>;
  files: ReadonlyArray<{
    id: string;
    storageMutation?: unknown | null;
  }>;
}) =>
  new Set(
    [...childFolders, ...files]
      .filter((item) => item.storageMutation)
      .map((item) => item.id),
  );

export const reconcileCutItems = <T extends { id: string }>({
  currentItems,
  attemptedItems,
  failedIds,
}: {
  currentItems: readonly T[];
  attemptedItems: ReadonlyArray<{ id: string }>;
  failedIds: ReadonlySet<string>;
}) => {
  const attemptedIds = new Set(attemptedItems.map((item) => item.id));
  return currentItems.filter(
    (item) => !attemptedIds.has(item.id) || failedIds.has(item.id),
  );
};

export const getOptimisticSourceMoveIds = ({
  results,
  initiallyListedIds,
}: {
  results: BatchMoveResponse["results"];
  initiallyListedIds: ReadonlySet<string>;
}) =>
  new Set(
    results
      .filter(
        (result) =>
          result.status === "moved" && initiallyListedIds.has(result.id),
      )
      .map((result) => result.id),
  );

export const getRetryableMoveItems = (
  response: BatchMoveResponse,
): BatchMoveItem[] =>
  response.results
    .filter(
      (
        result,
      ): result is Extract<
        BatchMoveResponse["results"][number],
        { status: "failed" }
      > => result.status === "failed" && result.retryable === true,
    )
    .map(({ id, kind }) => ({ id, kind }));

export const buildBatchMoveFailureMessage = ({
  response,
  getItemName,
}: {
  response: BatchMoveResponse;
  getItemName: (item: BatchMoveItem) => string;
}) => {
  const detail = response.results
    .filter((result) => result.status === "failed")
    .map((failure) => `${getItemName(failure)}: ${failure.error}`)
    .join("; ");

  return `${response.movedCount} moved. ${response.failedCount} failed — ${detail}`;
};

export const isBatchMoveOperationResponse = (
  value: unknown,
): value is BatchMoveOperationResponse => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as {
    operationId?: unknown;
    status?: unknown;
  };
  return (
    typeof candidate.operationId === "string" &&
    ["queued", "running", "succeeded", "recovery_required"].includes(
      candidate.status as string,
    )
  );
};

const POLL_MS = 1_000;
// Ten minutes; a move still running after that shows up after a refresh.
const MAX_POLLS = 600;

const errorOf = (value: unknown) =>
  (value as { error?: string } | null)?.error ?? "Items could not be moved.";

const isSettled = (value: unknown): value is BatchMoveOperationResponse =>
  isBatchMoveOperationResponse(value) &&
  value.status !== "queued" &&
  value.status !== "running";

// Follows a queued move until the server says how it ended.
async function waitForMove(operationId: string | null, first: unknown) {
  let value = first;
  for (let polls = 0; ; polls++) {
    if (isSettled(value)) return value;
    if (!operationId || polls >= MAX_POLLS) {
      throw new Error("The move is taking long. Refresh to see where it is.");
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const poll = await fetch(
      `/api/files/move/${encodeURIComponent(operationId)}`,
      { headers: { Accept: "application/json" } },
    );
    if (poll.status === 404) throw new Error("This move could not be tracked.");
    value = await poll.json().catch(() => null);
  }
}

/**
 * Moves items and waits until the server finishes, for lists outside Files
 * (Recent, Favorites, Search, Home). Files tracks its own moves in place.
 */
export async function submitMove(
  items: BatchMoveItem[],
  destinationFolderId: string,
): Promise<BatchMoveResponse> {
  const response = await fetch("/api/files/move", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": randomClientId(),
    },
    body: JSON.stringify({ items, destinationFolderId, source: "direct" }),
  });
  const value: unknown = await response.json().catch(() => null);
  const queued = isBatchMoveOperationResponse(value);
  if (!response.ok && !queued) throw new Error(errorOf(value));
  const done = await waitForMove(
    queued ? value.operationId : response.headers.get("X-Storage-Mutation-Id"),
    value,
  );
  if (done.status === "recovery_required" || !done.response) {
    throw new Error(done.error ?? "This move could not finish.");
  }
  return done.response;
}
