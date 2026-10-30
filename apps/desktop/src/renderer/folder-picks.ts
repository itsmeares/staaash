import { buildMoveTree, lineage } from "@/src/workspace/move-tree";

import type { ServerFolder } from "../shared/types";

export type FolderTree = ReturnType<typeof buildMoveTree<ServerFolder>>;

/** The folders with nothing inside. A tick is stored on these only. */
const leaves = (tree: FolderTree, id: string): string[] => {
  const children = tree.childrenOf.get(id) ?? [];
  return children.length === 0
    ? [id]
    : children.flatMap((child) => leaves(tree, child.id));
};

export const tickOf = (
  tree: FolderTree,
  ticked: ReadonlySet<string>,
  id: string,
) => {
  const all = leaves(tree, id);
  const on = all.filter((leaf) => ticked.has(leaf)).length;
  if (on === 0) return "off";
  return on === all.length ? "on" : "part";
};

export const toggleTick = (
  tree: FolderTree,
  ticked: ReadonlySet<string>,
  id: string,
) => {
  const next = new Set(ticked);
  const turnOff = tickOf(tree, ticked, id) === "on";
  for (const leaf of leaves(tree, id)) {
    if (turnOff) next.delete(leaf);
    else next.add(leaf);
  }
  return next;
};

/** The highest fully ticked folders: each one becomes a synced folder. */
export const pickedFolders = (
  tree: FolderTree,
  ticked: ReadonlySet<string>,
): ServerFolder[] => {
  const walk = (folder: ServerFolder): ServerFolder[] => {
    const tick = tickOf(tree, ticked, folder.id);
    if (tick === "on") return [folder];
    if (tick === "off") return [];
    return (tree.childrenOf.get(folder.id) ?? []).flatMap(walk);
  };
  return tree.root ? walk(tree.root) : [];
};

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
