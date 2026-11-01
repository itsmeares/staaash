import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { Store, type BaseEntry } from "./store";

const entry = (rel: string, ino: string): BaseEntry => ({
  pairId: "p",
  rel,
  type: "file",
  remoteId: `r-${rel}`,
  rev: 1,
  checksum: "c",
  size: 3,
  mtimeMs: 1000.5,
  ino,
});

let dir: string;
let file: string;

/** A database as the first release candidate left it: ids saved as numbers. */
const oldDatabase = (rows: Record<string, number>) => {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE base (
    pairId TEXT NOT NULL, rel TEXT NOT NULL, type TEXT NOT NULL,
    remoteId TEXT NOT NULL, rev INTEGER NOT NULL, checksum TEXT,
    size INTEGER NOT NULL, mtimeMs REAL NOT NULL, ino INTEGER NOT NULL,
    PRIMARY KEY (pairId, rel)
  )`);
  const insert = db.prepare(
    "INSERT INTO base VALUES ('p', ?, 'file', 'r', 1, 'c', 3, 1000.5, ?)",
  );
  for (const [rel, ino] of Object.entries(rows)) insert.run(rel, ino);
  return db;
};

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "staaash-store-"));
  file = path.join(dir, "sync.db");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("file ids in the store", () => {
  it("keeps ids of any size exactly, across a restart and a move", () => {
    const ids = [
      "9007199254740993",
      "17293822569102704931",
      "-1152921504606846685",
    ];
    const store = new Store(file);
    ids.forEach((ino, index) => store.putBase(entry(`dir/${index}`, ino)));
    store.moveBaseTree("p", "dir", "moved");
    store.close();

    const reopened = new Store(file);
    const saved = reopened.baseEntries("p");
    reopened.close();
    expect(saved.map((row) => row.rel).sort()).toEqual([
      "moved/0",
      "moved/1",
      "moved/2",
    ]);
    expect(saved.map((row) => row.ino).sort()).toEqual([...ids].sort());
  });

  it("upgrades an old database, trusting only ids too small to be rounded", () => {
    oldDatabase({
      zero: 0,
      small: 12345,
      largest: Number.MAX_SAFE_INTEGER,
      rounded: Number(9007199254740993n),
      huge: Number(0xf000000000000123n),
    }).close();

    const store = new Store(file);
    const saved = store.baseEntries("p");
    store.close();
    expect(Object.fromEntries(saved.map((row) => [row.rel, row.ino]))).toEqual({
      zero: "0",
      small: "12345",
      largest: "9007199254740991",
      rounded: "0",
      huge: "0",
    });
    expect(saved.every((row) => row.mtimeMs === 1000.5)).toBe(true);
  });

  it("changes nothing the second time it opens", () => {
    new Store(file).close();
    const store = new Store(file);
    store.putBase(entry("a", "9007199254740993"));
    store.close();
    const again = new Store(file);
    expect(again.baseEntries("p")[0]?.ino).toBe("9007199254740993");
    again.close();
  });

  it("leaves the old table whole if the upgrade fails", () => {
    const db = oldDatabase({ small: 12345 });
    // The wrong shape, so copying the rows fails partway through the upgrade.
    db.exec("CREATE TABLE base_upgrade (only TEXT)");
    db.close();

    expect(() => new Store(file)).toThrow();

    const check = new DatabaseSync(file);
    expect(check.prepare("SELECT rel, ino FROM base").all()).toEqual([
      expect.objectContaining({ rel: "small", ino: 12345 }),
    ]);
    check.close();
  });
});
