import { describe, expect, it } from "vite-plus/test";

import {
  blockedFolders,
  buildMoveTree,
  lineage,
  noteFor,
} from "@/app/(workspace)/move-tree";
import type { MoveTarget } from "@/server/files/types";

const folder = (id: string, parentId: string | null): MoveTarget => ({
  id,
  parentId,
  name: id,
  pathLabel: id,
  isFilesRoot: parentId === null,
  color: null,
});

const folders = [
  folder("root", null),
  folder("photos", "root"),
  folder("lisbon", "photos"),
  folder("old", "lisbon"),
  folder("work", "root"),
];

describe("move tree", () => {
  const { root, childrenOf, byId } = buildMoveTree(folders);

  it("finds the drive's top and each folder's children", () => {
    expect(root?.id).toBe("root");
    expect(childrenOf.get("root")?.map((f) => f.id)).toEqual([
      "photos",
      "work",
    ]);
    expect(lineage(byId, "old")).toEqual(["old", "lisbon", "photos", "root"]);
  });

  it("refuses where the items are and anything inside a moving folder", () => {
    const moving = new Set(["lisbon"]);
    const blocked = blockedFolders(byId, "photos", moving);
    expect(["root", "photos", "lisbon", "old", "work"].map(blocked)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    expect(noteFor("lisbon", "photos", moving)).toBe(
      "this is what you're moving",
    );
    expect(noteFor("photos", "photos", moving)).toBe("already here");
    expect(noteFor("old", "photos", moving)).toBeUndefined();
  });
});
