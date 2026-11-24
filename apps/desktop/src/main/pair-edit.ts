import type { PairEdit, SyncPair } from "../shared/types";

/**
 * Applies one change to the pairs as they are now. Windows send the change,
 * not a whole list, so two changes in flight never undo each other.
 */
export const editPairs = (pairs: SyncPair[], pairId: string, edit: PairEdit) =>
  pairs.flatMap((pair) => {
    if (pair.id !== pairId) return [pair];
    if ("remove" in edit) return [];
    if ("mode" in edit) return [{ ...pair, mode: edit.mode }];
    const rel = "skipPath" in edit ? edit.skipPath : edit.syncPath;
    const others = (pair.skipPaths ?? []).filter((each) => each !== rel);
    return [
      {
        ...pair,
        skipPaths: "skipPath" in edit ? [...others, rel].sort() : others,
      },
    ];
  });
