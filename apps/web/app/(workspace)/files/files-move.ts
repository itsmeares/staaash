import type { BatchMoveItem, BatchMoveResponse } from "@/server/files/types";

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
