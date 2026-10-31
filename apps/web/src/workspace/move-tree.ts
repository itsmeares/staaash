type TreeFolder = { id: string; parentId: string | null; isFilesRoot: boolean };

/** The folder list as a tree: the drive's top, children by parent, lookup. */
export function buildMoveTree<T extends TreeFolder>(folders: T[]) {
  const childrenOf = new Map<string, T[]>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    childrenOf.set(folder.parentId, [
      ...(childrenOf.get(folder.parentId) ?? []),
      folder,
    ]);
  }
  return {
    root: folders.find((folder) => folder.isFilesRoot) ?? null,
    childrenOf,
    byId: new Map(folders.map((folder) => [folder.id, folder])),
  };
}

type Lookup = ReadonlyMap<string, { parentId: string | null }>;

/** The folder and every folder above it, nearest first. */
export function lineage(byId: Lookup, id: string | null) {
  const ids: string[] = [];
  for (
    let at = id;
    at && !ids.includes(at);
    at = byId.get(at)?.parentId ?? null
  ) {
    ids.push(at);
  }
  return ids;
}

/**
 * Where items may not go: the folder they are all in now, the folders being
 * moved, and anything inside those.
 */
export function blockedFolders(
  byId: Lookup,
  here: string | null,
  movingIds: ReadonlySet<string>,
) {
  return (id: string) =>
    id === here || lineage(byId, id).some((at) => movingIds.has(at));
}

/** What the picker says on a row it won't take. */
export const noteFor = (
  id: string,
  here: string | null,
  movingIds: ReadonlySet<string>,
) => {
  if (movingIds.has(id)) return "this is what you're moving";
  return id === here ? "already here" : undefined;
};
