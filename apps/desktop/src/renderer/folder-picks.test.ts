import { expect, it } from "vite-plus/test";

import { buildMoveTree } from "@/src/workspace/move-tree";

import {
  findFolders,
  namesTo,
  pickedFolders,
  tickOf,
  toggleTick,
} from "./folder-picks";

const folder = (id: string, parentId: string | null) => ({
  id,
  parentId,
  name: id,
  pathLabel: id,
  isFilesRoot: parentId === null,
  size: 0,
});

const tree = buildMoveTree([
  folder("root", null),
  folder("Photos", "root"),
  folder("2024", "Photos"),
  folder("2025", "Photos"),
  folder("Work", "root"),
]);

const ids = (ticked: ReadonlySet<string>) =>
  pickedFolders(tree, ticked).map(({ id }) => id);

it("syncs the highest fully ticked folder, once", () => {
  const photos = toggleTick(tree, new Set(), "Photos");
  expect(ids(photos)).toEqual(["Photos"]);
  expect(ids(toggleTick(tree, photos, "Work"))).toEqual(["root"]);
});

it("splits a folder into its ticked children when one is unticked", () => {
  const photos = toggleTick(tree, new Set(), "Photos");
  const without = toggleTick(tree, photos, "2024");
  expect(tickOf(tree, without, "Photos")).toBe("part");
  expect(ids(without)).toEqual(["2025"]);
});

it("ticks a part-ticked folder fully, then clears it", () => {
  const part = toggleTick(tree, new Set(), "2024");
  const full = toggleTick(tree, part, "Photos");
  expect(tickOf(tree, full, "Photos")).toBe("on");
  expect(tickOf(tree, toggleTick(tree, full, "Photos"), "Photos")).toBe("off");
});

it("finds folders by name or path, with either slash", () => {
  const found = (typed: string) =>
    findFolders(tree, typed).map(({ folder: match }) => match.id);
  expect(found("2025")).toEqual(["2025"]);
  expect(found("photos\\2024/")).toEqual(["2024"]);
  expect(found("  ")).toEqual([]);
  expect(namesTo(tree, "2024")).toEqual(["Photos", "2024"]);
});
