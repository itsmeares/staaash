import { expect, it } from "vite-plus/test";

import type { SyncPair } from "../shared/types";
import { editPairs } from "./pair-edit";

const pair = (id: string, skipPaths?: string[]): SyncPair => ({
  id,
  localPath: `/home/demo/${id}`,
  remoteFolderId: id,
  remoteLabel: id,
  mode: "two-way",
  skipPaths,
});

it("keeps a skip made while another one was in flight", () => {
  const first = editPairs([pair("a")], "a", { skipPath: "b.mkv" });
  const second = editPairs(first, "a", { skipPath: "a.mkv" });
  expect(second[0]!.skipPaths).toEqual(["a.mkv", "b.mkv"]);
});

it("skips a path once and syncs it again", () => {
  const twice = editPairs([pair("a", ["x.mkv"])], "a", { skipPath: "x.mkv" });
  expect(twice[0]!.skipPaths).toEqual(["x.mkv"]);
  const back = editPairs(twice, "a", { syncPath: "x.mkv" });
  expect(back[0]!.skipPaths).toEqual([]);
});

it("changes or removes only the named pair", () => {
  const pairs = [pair("a"), pair("b")];
  expect(
    editPairs(pairs, "b", { mode: "upload" }).map((each) => each.mode),
  ).toEqual(["two-way", "upload"]);
  expect(
    editPairs(pairs, "a", { remove: true }).map((each) => each.id),
  ).toEqual(["b"]);
});
