
import { useState } from "react";

type Direction = "asc" | "desc";

// Names and places start A to Z; sizes and dates start largest or newest.
const ASCENDING_FIRST = new Set(["name", "path", "location"]);

/** Column sorting for `FileList`: a second click on a column flips it. */
export function useListSort<K extends string>(key: K, direction: Direction) {
  const [sort, setSort] = useState({ key, direction });
  return {
    ...sort,
    onSort: (next: string) =>
      setSort((current) =>
        current.key === next
          ? {
              key: current.key,
              direction: current.direction === "asc" ? "desc" : "asc",
            }
          : {
              key: next as K,
              direction: ASCENDING_FIRST.has(next) ? "asc" : "desc",
            },
      ),
  };
}
