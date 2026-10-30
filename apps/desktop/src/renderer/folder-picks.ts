import { buildMoveTree, lineage } from "@/src/workspace/move-tree";

import type { ServerFolder } from "../shared/types";

export type FolderTree = ReturnType<typeof buildMoveTree<ServerFolder>>;

/**
 * What is ticked: folders picked to sync with all they hold, and folders
 * left out of a picked folder above them.
 */
export type Picks = {
  included: ReadonlySet<string>;
  skipped: ReadonlySet<string>;
};

const below = (tree: FolderTree, id: string): string[] =>
  (tree.childrenOf.get(id) ?? []).flatMap((child) => [
    child.id,
    ...below(tree, child.id),
  ]);

/** The picked folder that holds `id`, unless a skip lies between them. */
export const pickHolding = (tree: FolderTree, picks: Picks, id: string) => {
  for (const at of lineage(tree.byId, id)) {
    if (picks.skipped.has(at)) return null;
    if (picks.included.has(at)) return at;
  }
  return null;
};

export const tickOf = (tree: FolderTree, picks: Picks, id: string) => {
  const inside = below(tree, id);
  if (pickHolding(tree, picks, id)) {
    return inside.some((at) => picks.skipped.has(at)) ? "part" : "on";
  }
  return inside.some((at) => picks.included.has(at)) ? "part" : "off";
};

// Ticking and unticking mean different things inside and outside a pick.
// fallow-ignore-next-line complexity
export const toggleTick = (
  tree: FolderTree,
  picks: Picks,
  id: string,
): Picks => {
  const included = new Set(picks.included);
  const skipped = new Set(picks.skipped);
  for (const at of below(tree, id)) {
    included.delete(at);
    skipped.delete(at);
  }
  if (tickOf(tree, picks, id) === "on") {
    if (included.has(id)) included.delete(id);
    else skipped.add(id);
  } else if (skipped.has(id)) {
    skipped.delete(id);
  } else if (!pickHolding(tree, picks, id)) {
    included.add(id);
  }
  return { included, skipped };
};

/** The picked folders, each with the folders it leaves out. */
export const pickedFolders = (tree: FolderTree, picks: Picks) =>
  [...tree.byId.values()]
    .filter((folder) => picks.included.has(folder.id))
    .map((folder) => ({
      folder,
      skips: [...picks.skipped].flatMap((id) => {
        const skip = tree.byId.get(id);
        return skip?.parentId &&
          pickHolding(tree, picks, skip.parentId) === folder.id
          ? [skip]
          : [];
      }),
    }));

/** Folder names from below the drive's top down to `id`. */
export const namesTo = (tree: FolderTree, id: string) =>
  lineage(tree.byId, id)
    .filter((at) => at !== tree.root?.id)
    .reverse()
    .map((at) => tree.byId.get(at)?.name ?? "");

/** Folders whose path holds what was typed; `\` and `/` both separate. */
export const findFolders = (tree: FolderTree, typed: string) => {
  const term = typed
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  if (!term) return [];
  return [...tree.byId.values()]
    .map((folder) => ({ folder, path: namesTo(tree, folder.id).join("/") }))
    .filter(({ path }) => path.toLowerCase().includes(term))
    .sort((a, b) => a.path.length - b.path.length);
};
