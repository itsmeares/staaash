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
  checksum: string | null,
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
    excluded: [],
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

  describe("a server file with no checksum", () => {
    it("compares contents before setting a first-seen local file aside", () => {
      const here = { ...file("a.txt"), checksum: "mine" };
      const remote = remoteFile("a.txt", "r1", null);
      const [action] = run({ local: [here], remote: [remote] }).actions;
      expect(action).toMatchObject({
        kind: "conflict-copy",
        unverified: { remote: remote.item, checksum: "mine" },
      });
    });

    it("does nothing while neither side changed", () => {
      const here = file("a.txt");
      const result = run({
        local: [here],
        remote: [remoteFile("a.txt", "r1", null)],
        base: [baseOf(here, "r1", "mine")],
      });
      expect(result.actions).toEqual([]);
    });

    it("trashes it on the server when it was deleted here", () => {
      const gone = file("a.txt");
      const result = run({
        remote: [remoteFile("a.txt", "r1", null)],
        base: [baseOf(gone, "r1", "mine")],
      });
      expect(kinds(result)).toEqual(["trash-remote:a.txt"]);
    });

    it("trashes its folder on the server when the folder was deleted here", () => {
      const inside = file("docs/a.txt");
      const result = run({
        remote: [
          remoteFolder("docs", "d1"),
          remoteFile("docs/a.txt", "r1", null),
        ],
        base: [
          baseOf(folder("docs"), "d1", null),
          baseOf(inside, "r1", "mine"),
        ],
      });
      expect(kinds(result)).toEqual(["trash-remote:docs"]);
    });

    it("downloads again only when its revision moves", () => {
      const here = file("a.txt");
      const result = run({
        local: [here],
        remote: [remoteFile("a.txt", "r1", null, 2)],
        base: [baseOf(here, "r1", "mine")],
      });
      expect(kinds(result)).toEqual(["download:a.txt"]);
    });
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
  it("finishes a move whose server half stopped after the move, before the rename", () => {
    const before = file("A/old.txt", 3, 1000, 7);
    const after = { ...before, rel: "B/new.txt" };
    const result = run({
      local: [folder("A", 1), folder("B", 2), after],
      remote: [
        remoteFolder("A", "fa"),
        remoteFolder("B", "fb"),
        remoteFile("B/old.txt", "r1", "x", 2),
      ],
      base: [
        baseOf(folder("A", 1), "fa", null),
        baseOf(folder("B", 2), "fb", null),
        baseOf(before, "r1", "x"),
      ],
    });
    expect(kinds(result)).toEqual(["move-remote:A/old.txt"]);
    expect(result.actions[0]).toMatchObject({ to: "B/new.txt" });
  });

  it("does not take over a different move made on the server", () => {
    const before = file("A/old.txt", 3, 1000, 7);
    const result = run({
      local: [folder("A", 1), folder("B", 2), { ...before, rel: "B/new.txt" }],
      remote: [
        remoteFolder("A", "fa"),
        remoteFolder("B", "fb"),
        remoteFolder("C", "fc"),
        remoteFile("C/other.txt", "r1", "x", 2),
      ],
      base: [
        baseOf(folder("A", 1), "fa", null),
        baseOf(folder("B", 2), "fb", null),
        baseOf(before, "r1", "x"),
      ],
    });
    expect(kinds(result)).not.toContain("move-remote:A/old.txt");
  });

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

  it("upload-only keeps the server copy of a file deleted here", () => {
    const result = run({
      mode: "upload",
      remote: [remoteFile("a.txt", "r1", "x")],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["forget:a.txt"]);
  });

  it("upload-only keeps the server folder deleted here", () => {
    const dir = folder("docs", 30);
    const result = run({
      mode: "upload",
      remote: [remoteFolder("docs", "f1")],
      base: [baseOf(dir, "f1", null)],
    });
    expect(kinds(result)).toEqual(["forget:docs"]);
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

describe("excluded paths are never deletions", () => {
  const here = file("a.txt", 3, 1000, 1);
  const synced = baseOf(here, "r1", "x");

  it("leaves an already synced file alone once its name is ignored", () => {
    const result = run({
      remote: [remoteFile("a.txt", "r1", "x")],
      excluded: [{ side: "local", rel: "a.txt", ino: 1 }],
      base: [synced],
    });
    expect(result.actions).toEqual([]);
  });

  it("neither downloads nor trashes a server file with an ignored name", () => {
    const tmp = file("report.tmp", 3, 1000, 2);
    const result = run({
      excluded: [
        { side: "remote", rel: "report.tmp", remoteId: "r2" },
        { side: "local", rel: "report.tmp", ino: 2 },
      ],
      // Left behind by an earlier version that downloaded it.
      base: [baseOf(tmp, "r2", "x")],
    });
    expect(result.actions).toEqual([]);
  });

  it("leaves an ignored folder and everything in it alone", () => {
    const dir = folder("node_modules", 10);
    const inside = file("node_modules/x.js", 3, 1000, 11);
    const result = run({
      remote: [
        remoteFolder("node_modules", "f1"),
        remoteFile("node_modules/x.js", "r1", "x"),
      ],
      excluded: [{ side: "local", rel: "node_modules", ino: 10 }],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(result.actions).toEqual([]);
  });

  it("keeps a server folder deleted here while it holds an ignored file", () => {
    const dir = folder("docs", 10);
    const result = run({
      remote: [remoteFolder("docs", "f1")],
      excluded: [{ side: "remote", rel: "docs/x.tmp", remoteId: "r5" }],
      base: [baseOf(dir, "f1", null)],
    });
    expect(kinds(result)).toEqual(["mkdir:docs"]);
  });

  it("keeps a local folder the server deleted while it holds an ignored file", () => {
    const dir = folder("docs", 10);
    const result = run({
      local: [dir, file("b.txt")],
      excluded: [{ side: "local", rel: "docs/x.tmp", ino: 12 }],
      base: [baseOf(dir, "f1", null)],
    });
    expect(kinds(result)).not.toContain("trash-local:docs");
  });

  it("forgets, not trashes, a file renamed here to an ignored name", () => {
    const result = run({
      remote: [remoteFile("a.txt", "r1", "x")],
      excluded: [{ side: "local", rel: "a.txt.tmp", ino: 1 }],
      base: [synced],
    });
    expect(kinds(result)).toEqual(["forget:a.txt"]);
  });

  it("forgets, not trashes, a folder renamed here to an ignored name", () => {
    const dir = folder("docs", 10);
    const inside = file("docs/a.txt", 3, 1000, 11);
    const result = run({
      local: [file("b.txt")],
      remote: [remoteFolder("docs", "f1"), remoteFile("docs/a.txt", "r1", "x")],
      excluded: [{ side: "local", rel: "docs.tmp", ino: 10 }],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(kinds(result).sort()).toEqual([
      "forget:docs",
      "forget:docs/a.txt",
      "upload:b.txt",
    ]);
  });

  it("forgets, not trashes, a folder the server renamed to an ignored name", () => {
    const dir = folder("docs", 10);
    const inside = file("docs/a.txt", 3, 1000, 11);
    const result = run({
      local: [dir, inside, file("b.txt")],
      excluded: [{ side: "remote", rel: "docs.tmp", remoteId: "f1" }],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(kinds(result).sort()).toEqual([
      "forget:docs",
      "forget:docs/a.txt",
      "upload:b.txt",
    ]);
  });

  it("forgets, not trashes, a file the server renamed to an ignored name", () => {
    const result = run({
      local: [here, file("b.txt")],
      excluded: [{ side: "remote", rel: "a.tmp", remoteId: "r1" }],
      base: [synced],
    });
    expect(kinds(result)).toContain("forget:a.txt");
    expect(kinds(result)).not.toContain("trash-local:a.txt");
  });

  it("forgets, not trashes, a file the server renamed to a name this computer cannot hold", () => {
    const result = run({
      local: [here, file("b.txt")],
      skipped: [
        {
          rel: "a:b.txt",
          item: remoteFile("a:b.txt", "r1", "x").item,
          reason: "nope",
        },
      ],
      base: [synced],
    });
    expect(kinds(result)).not.toContain("trash-local:a.txt");
  });

  it("does not trash server files under a folder that could not be read", () => {
    const dir = folder("locked", 10);
    const inside = file("locked/a.txt", 3, 1000, 11);
    const result = run({
      remote: [
        remoteFolder("locked", "f1"),
        remoteFile("locked/a.txt", "r1", "x"),
      ],
      excluded: [{ side: "local", rel: "locked" }],
      base: [baseOf(dir, "f1", null), baseOf(inside, "r1", "x")],
    });
    expect(result.actions).toEqual([]);
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
