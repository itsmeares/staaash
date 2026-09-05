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
