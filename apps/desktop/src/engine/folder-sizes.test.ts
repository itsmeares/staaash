import { afterEach, expect, it } from "vite-plus/test";
import type { SyncPair } from "../shared/types";
import { folderSizes } from "./folder-sizes";
import type { LocalScan } from "./local";
import { createIgnore } from "./names";
import { RemoteTree } from "./remote";
import { Store, type RemoteItem } from "./store";

const store = new Store(":memory:");
afterEach(() => store.clearRemote());
const item = (
  id: string,
  parentId: string,
  type: "file" | "folder",
  size: number | null,
): RemoteItem => ({
  id,
  parentId,
  name: id,
  type,
  size,
  checksum: null,
  rev: 1,
  modifiedAt: null,
});
const pair: SyncPair = {
  id: "pair",
  localPath: "/fake",
  remoteFolderId: "root",
  remoteLabel: "root",
  mode: "upload",
  skipFolders: [{ id: "skip", label: "skip" }],
};
const scan: LocalScan = {
  entries: [
    { rel: "local", type: "file", size: 8, mtimeMs: 0, ino: "1" },
    { rel: "skip/local", type: "file", size: 100, mtimeMs: 0, ino: "2" },
  ],
  excluded: [],
};

it("counts each side independently and leaves skipped folders out", () => {
  const tree = new RemoteTree(store, new Set(["root"]));
  tree.addUnder([
    item("skip", "root", "folder", null),
    item("hidden", "skip", "file", 100),
    item("remote", "root", "file", 5),
  ]);
  expect(folderSizes(tree, pair, createIgnore([]), scan)).toEqual({
    server: 5,
    computer: 8,
  });
  expect(
    folderSizes(tree, { ...pair, mode: "download" }, createIgnore([]), scan),
  ).toEqual({ server: 5, computer: 8 });
  expect(
    folderSizes(tree, { ...pair, mode: "two-way" }, createIgnore([]), scan),
  ).toEqual({ server: 5, computer: 8 });
});

it("does not present an incomplete local scan as a complete total", () => {
  const tree = new RemoteTree(store, new Set(["root"]));
  tree.addUnder([
    item("skip", "root", "folder", null),
    item("remote", "root", "file", 5),
  ]);
  expect(
    folderSizes(tree, pair, createIgnore([]), {
      ...scan,
      excluded: [{ rel: "unreadable", reason: "error", unreadable: true }],
    }),
  ).toEqual({ server: 5, computer: null });
  expect(
    folderSizes(tree, pair, createIgnore([]), {
      ...scan,
      excluded: [{ rel: "skip/unreadable", reason: "error", unreadable: true }],
    }),
  ).toEqual({ server: 5, computer: 8 });
  tree.removeSubtree("skip");
  expect(folderSizes(tree, pair, createIgnore([]), scan).computer).toBeNull();
});
