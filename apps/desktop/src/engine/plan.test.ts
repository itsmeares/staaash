import { describe, expect, it } from "vite-plus/test";

import type { SyncMode } from "../shared/types";
import type { LocalFile, PlanInput } from "./plan";
import { conflictCopyName, plan } from "./plan";
import type { BaseEntry, RemoteItem } from "./store";

let nextIno = 100;
const file = (
  rel: string,
  size = 3,
  mtimeMs = 1000,
  ino = nextIno++,
): LocalFile => ({
  rel,
  type: "file",
  size,
  mtimeMs,
  ino,
});
const folder = (rel: string, ino = nextIno++): LocalFile => ({
  rel,
  type: "folder",
  size: 0,
  mtimeMs: 1,
  ino,
});
const remoteFile = (
  rel: string,
  id: string,
  checksum: string,
  rev = 1,
): { rel: string; item: RemoteItem } => ({
  rel,
  item: {
    id,
    type: "file",
    parentId: "parent",
    name: rel.split("/").at(-1) ?? rel,
    size: 3,
    checksum,
    rev,
    modifiedAt: null,
  },
});
const remoteFolder = (rel: string, id: string) => ({
  rel,
  item: {
    id,
    type: "folder" as const,
    parentId: "parent",
    name: rel.split("/").at(-1) ?? rel,
    size: null,
    checksum: null,
    rev: 1,
    modifiedAt: null,
  },
});
const baseOf = (
  local: LocalFile,
  remoteId: string,
  checksum: string | null,
  rev = 1,
): BaseEntry => ({
  pairId: "p",
  rel: local.rel,
  type: local.type,
  remoteId,
  rev,
  checksum,
  size: local.size,
  mtimeMs: local.mtimeMs,
  ino: local.ino,
});

const run = (input: Partial<PlanInput> & { mode?: SyncMode }) =>
  plan({
    pairId: "p",
    mode: "two-way",
    local: [],
    remote: [],
    skipped: [],
    base: [],
    ...input,
  });

const kinds = (result: ReturnType<typeof plan>) =>
  result.actions.map(
    (action) => `${action.kind}:${"rel" in action ? action.rel : action.from}`,
  );

describe("first sync", () => {
  it("links equal files without moving bytes", () => {
    const here = { ...file("a.txt"), checksum: "x" };
    const result = run({
      local: [here],
      remote: [remoteFile("a.txt", "r1", "x")],
    });
    expect(kinds(result)).toEqual(["link:a.txt"]);
  });

  it("asks for a checksum before deciding about a file on both sides", () => {
    const here = file("a.txt");
    const result = run({
      local: [here],
      remote: [remoteFile("a.txt", "r1", "x")],
    });
    expect(result.actions).toEqual([]);
    expect(result.needsHash).toEqual([here]);
  });

  it("keeps both versions when they differ", () => {
    const here = { ...file("a.txt"), checksum: "mine" };
    const result = run({
      local: [here],
      remote: [remoteFile("a.txt", "r1", "theirs")],
    });
    expect(kinds(result)).toEqual(["conflict-copy:a.txt"]);
  });

  it("uploads and downloads what only one side has, and deletes nothing", () => {
    const result = run({
      local: [file("mine.txt")],
      remote: [remoteFile("theirs.txt", "r1", "x")],
    });
    expect(kinds(result).sort()).toEqual([
      "download:theirs.txt",
      "upload:mine.txt",
    ]);
  });
});

describe("two-way", () => {
  const here = file("a.txt", 3, 1000, 1);
  const synced = baseOf(here, "r1", "x");

  it("does nothing when neither side changed", () => {
    const result = run({
      local: [here],
      remote: [remoteFile("a.txt", "r1", "x")],
      base: [synced],
    });
    expect(result.actions).toEqual([]);
  });

  it("uploads a local edit against the revision it last saw", () => {
    const edited = { ...file("a.txt", 4, 2000, 1), checksum: "y" };
    const result = run({
      local: [edited],
      remote: [remoteFile("a.txt", "r1", "x", 3)],
      base: [synced],
    });
    expect(result.actions).toEqual([
      {
        kind: "upload",
        rel: "a.txt",
        local: edited,
        replace: { remoteId: "r1", rev: 3 },
      },
    ]);
  });

  it("downloads a server edit", () => {
    const result = run({
      local: [here],
      remote: [remoteFile("a.txt", "r1", "y", 2)],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["download:a.txt"]);
  });

  it("is not a conflict when only the revision moved", () => {
    const result = run({
      local: [here],
      remote: [remoteFile("a.txt", "r1", "x", 9)],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["link:a.txt"]);
  });

  it("keeps both versions when both sides edited", () => {
    const edited = { ...file("a.txt", 4, 2000, 1), checksum: "mine" };
    const result = run({
      local: [edited],
      remote: [remoteFile("a.txt", "r1", "theirs", 2)],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["conflict-copy:a.txt"]);
  });

  it("trashes on the server what was deleted here", () => {
    const result = run({
      remote: [remoteFile("a.txt", "r1", "x")],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["trash-remote:a.txt"]);
  });

  it("brings a file back when the server edited what was deleted here", () => {
    const result = run({
      remote: [remoteFile("a.txt", "r1", "y", 2)],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["download:a.txt"]);
  });

  it("trashes here what was deleted on the server", () => {
    const result = run({ local: [here, file("b.txt")], base: [synced] });
    expect(kinds(result)).toContain("trash-local:a.txt");
  });

  it("uploads again when this computer edited what the server deleted", () => {
    const edited = file("a.txt", 9, 5000, 1);
    const result = run({ local: [edited, file("b.txt")], base: [synced] });
    expect(result.actions).toContainEqual({
      kind: "upload",
      rel: "a.txt",
      local: edited,
      replace: null,
    });
  });

  const many = Array.from({ length: 10 }, (_, index) => {
    const each = file(`f${index}.txt`);
    return {
      local: each,
      remote: remoteFile(each.rel, `r${index}`, "x"),
      base: baseOf(each, `r${index}`, "x"),
    };
  });

  it("holds when every file of a big folder disappeared from this computer", () => {
    const result = run({
      remote: many.map((each) => each.remote),
      base: many.map((each) => each.base),
    });
    expect(result.hold).toEqual({ side: "local" });
    expect(result.actions).toEqual([]);
  });

  it("holds when a big server folder became empty", () => {
    const result = run({
      local: many.map((each) => each.local),
      base: many.map((each) => each.base),
    });
    expect(result.hold).toEqual({ side: "server" });
  });

  it("goes ahead once the person confirmed the emptied folder", () => {
    const result = run({
      remote: many.map((each) => each.remote),
      base: many.map((each) => each.base),
      allowEmptied: true,
    });
    expect(result.actions).toHaveLength(10);
  });
});

describe("folders", () => {
  it("trashes a folder deleted here in one step when nothing inside changed on the server", () => {
    const dir = folder("docs", 10);
    const inside = file("docs/a.txt", 3, 1000, 11);
    const result = run({
      remote: [remoteFolder("docs", "f1"), remoteFile("docs/a.txt", "r1", "x")],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(kinds(result)).toEqual(["trash-remote:docs"]);
  });

  it("keeps a deleted folder when the server changed something inside", () => {
    const dir = folder("docs", 10);
    const inside = file("docs/a.txt", 3, 1000, 11);
    const result = run({
      remote: [
        remoteFolder("docs", "f1"),
        remoteFile("docs/a.txt", "r1", "changed", 2),
      ],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(kinds(result)).toEqual(["mkdir:docs", "download:docs/a.txt"]);
  });
});

describe("moves", () => {
  it("repeats a server rename here instead of downloading again", () => {
    const here = file("old.txt", 3, 1000, 7);
    const result = run({
      local: [here],
      remote: [remoteFile("new.txt", "r1", "x", 2)],
      base: [baseOf(here, "r1", "x")],
    });
    expect(kinds(result)).toEqual(["move-local:old.txt"]);
  });

  it("repeats a local rename on the server instead of uploading again", () => {
    const before = file("old.txt", 3, 1000, 7);
    const after = { ...before, rel: "new.txt" };
    const result = run({
      local: [after],
      remote: [remoteFile("old.txt", "r1", "x")],
      base: [baseOf(before, "r1", "x")],
    });
    expect(kinds(result)).toEqual(["move-remote:old.txt"]);
  });

  it("moves a whole folder once, not each file inside", () => {
    const dir = folder("a", 20);
    const inside = file("a/x.txt", 3, 1000, 21);
    const result = run({
      local: [dir, inside],
      remote: [remoteFolder("b", "f1"), remoteFile("b/x.txt", "r1", "x")],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(kinds(result)).toEqual(["move-local:a"]);
  });
});

describe("one-way folders", () => {
  const here = file("a.txt", 3, 1000, 1);
  const synced = baseOf(here, "r1", "x");

  it("download-only keeps a local edit aside and brings the server version back", () => {
    const edited = { ...file("a.txt", 4, 2000, 1), checksum: "mine" };
    const result = run({
      mode: "download",
      local: [edited],
      remote: [remoteFile("a.txt", "r1", "x")],
      base: [synced],
    });
    expect(result.actions).toEqual([
      { kind: "conflict-copy", rel: "a.txt", local: edited, localOnly: true },
    ]);
  });

  it("download-only never uploads a new local file", () => {
    const result = run({ mode: "download", local: [file("new.txt")] });
    expect(result.actions).toEqual([]);
  });

  it("upload-only never downloads", () => {
    const result = run({
      mode: "upload",
      remote: [remoteFile("theirs.txt", "r1", "x")],
    });
    expect(result.actions).toEqual([]);
  });

  it("upload-only wins a conflict with keep-mine", () => {
    const edited = { ...file("a.txt", 4, 2000, 1), checksum: "mine" };
    const result = run({
      mode: "upload",
      local: [edited],
      remote: [remoteFile("a.txt", "r1", "theirs", 2)],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["keep-mine:a.txt"]);
  });
});

it("reports server items this computer cannot hold", () => {
  const result = run({
    skipped: [
      {
        rel: "a:b.txt",
        item: remoteFile("a:b.txt", "r9", "x").item,
        reason: "nope",
      },
    ],
  });
  expect(result.issues).toEqual([
    {
      pairId: "p",
      rel: "a:b.txt",
      kind: "invalid-name",
      message: "nope",
      remoteId: "r9",
    },
  ]);
});

it("names a conflict copy after the device and time, and never reuses a name", () => {
  const now = new Date(2026, 9, 22, 10, 15);
  const first = conflictCopyName(
    "Work/report.docx",
    "Aras-Laptop",
    now,
    () => false,
  );
  expect(first).toBe(
    "Work/report (conflict, Aras-Laptop, 2026-10-22 10-15).docx",
  );
  const second = conflictCopyName(
    "Work/report.docx",
    "Aras-Laptop",
    now,
    (rel) => rel === first,
  );
  expect(second).toBe(
    "Work/report (conflict, Aras-Laptop, 2026-10-22 10-15 2).docx",
  );
});
