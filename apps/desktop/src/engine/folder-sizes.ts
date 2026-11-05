import type { SyncPair } from "../shared/types";
import type { LocalScan } from "./local";
import { baseName, leftOutOf, pathKey } from "./names";
import type { RemoteTree } from "./remote";

export const folderSizes = (
  tree: RemoteTree,
  pair: SyncPair,
  ignore: (name: string) => boolean,
  scan: LocalScan | null,
) => {
  const leftOut = leftOutOf(pair);
  const { items, ignored, skipped } = tree.scope(
    pair.remoteFolderId,
    ignore,
    leftOut.remote,
  );
  const excluded = new Set(
    [...ignored, ...skipped].map(({ rel }) => pathKey(rel)),
  );
  const isExcluded = (rel: string) => {
    let key = pathKey(rel);
    while (key) {
      if (excluded.has(key)) return true;
      const slash = key.lastIndexOf("/");
      key = slash < 0 ? "" : key.slice(0, slash);
    }
    return false;
  };
  const remoteFiles = items.filter(({ item }) => item.type === "file");
  const server = remoteFiles.some(({ item }) => item.size === null)
    ? null
    : remoteFiles.reduce((sum, { item }) => sum + (item.size ?? 0), 0);
  const missingSkip = [...leftOut.ids].some(
    (id) => !ignored.some(({ item }) => item.id === id),
  );
  const incomplete = scan?.excluded.some(
    (entry) =>
      entry.unreadable &&
      !ignore(baseName(entry.rel)) &&
      !isExcluded(entry.rel),
  );
  const computer =
    !scan || missingSkip || incomplete
      ? null
      : scan.entries.reduce(
          (sum, entry) =>
            sum +
            (entry.type === "file" && !isExcluded(entry.rel) ? entry.size : 0),
          0,
        );
  return { server, computer };
};
