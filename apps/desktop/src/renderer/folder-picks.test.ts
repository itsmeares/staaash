import { expect, it } from "vite-plus/test";

import { buildMoveTree } from "@/src/workspace/move-tree";

import {
  type Picks,
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

const none = { included: new Set<string>(), skipped: new Set<string>() };
const summary = (picks: Picks) =>
  pickedFolders(tree, picks).map(({ folder: picked, skips }) => [
    picked.id,
    skips.map(({ id }) => id),
  ]);

it("syncs only the ticked folder, not its parents", () => {
  const photos = toggleTick(tree, none, "Photos");
  expect(summary(photos)).toEqual([["Photos", []]]);
  expect(tickOf(tree, photos, "root")).toBe("part");
});

it("keeps a folder syncing and skips the child that was unticked", () => {
  const photos = toggleTick(tree, none, "Photos");
  const without = toggleTick(tree, photos, "2024");
  expect(tickOf(tree, without, "Photos")).toBe("part");
  expect(tickOf(tree, without, "2024")).toBe("off");
  expect(summary(without)).toEqual([["Photos", ["2024"]]]);
  expect(summary(toggleTick(tree, without, "2024"))).toEqual([["Photos", []]]);
});

it("skips below the whole drive, keeping everything else", () => {
  const all = toggleTick(tree, none, "root");
  expect(summary(toggleTick(tree, all, "Work"))).toEqual([["root", ["Work"]]]);
});

it("makes a child of a skipped folder its own pick", () => {
  const all = toggleTick(tree, none, "root");
  const skipped = toggleTick(tree, all, "Photos");
  expect(summary(toggleTick(tree, skipped, "2025"))).toEqual([
    ["root", ["Photos"]],
    ["2025", []],
  ]);
});

it("clears everything inside when a ticked folder is ticked off", () => {
  const photos = toggleTick(tree, none, "Photos");
  const part = toggleTick(tree, photos, "2024");
  const full = toggleTick(tree, part, "Photos");
  expect(tickOf(tree, full, "Photos")).toBe("on");
  expect(summary(toggleTick(tree, full, "Photos"))).toEqual([]);
});

it("finds folders by name or path, with either slash", () => {
  const found = (typed: string) =>
    findFolders(tree, typed).map(({ folder: match }) => match.id);
  expect(found("2025")).toEqual(["2025"]);
  expect(found("photos\\2024/")).toEqual(["2024"]);
  expect(found("  ")).toEqual([]);
  expect(namesTo(tree, "2024")).toEqual(["Photos", "2024"]);
});
