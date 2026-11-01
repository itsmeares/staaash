import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { sameStat, scanLocal, statLocal } from "./local";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "staaash-local-"));
  mkdirSync(path.join(root, "docs"));
  writeFileSync(path.join(root, "docs", "a.txt"), "abc");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("reading files from disk", () => {
  it("keeps the times a plain stat gives, so saved history still matches", async () => {
    const { entries } = await scanLocal(root, () => false);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      const plain = lstatSync(path.join(root, entry.rel));
      expect(entry.mtimeMs).toBe(plain.mtimeMs);
      expect(entry.ino).toBe(
        String(lstatSync(path.join(root, entry.rel), { bigint: true }).ino),
      );
    }
  });

  it("follows a file through a rename by its id", async () => {
    const before = await statLocal(root, "docs/a.txt");
    await rename(path.join(root, "docs/a.txt"), path.join(root, "docs/b.txt"));
    const after = await statLocal(root, "docs/b.txt");
    expect(before && after && after.ino === before.ino).toBe(true);
  });
});

describe("sameStat", () => {
  const stat = { size: 3, mtimeMs: 1000, ino: "9007199254740993" };

  it("tells apart ids a number could not", () => {
    expect(sameStat(stat, { ...stat, ino: "9007199254740992" })).toBe(false);
  });

  it("goes by size and time when an id is unknown", () => {
    expect(sameStat(stat, { ...stat, ino: "0" })).toBe(true);
    expect(sameStat({ ...stat, ino: "0" }, stat)).toBe(true);
    expect(sameStat(stat, { ...stat, ino: "0", size: 4 })).toBe(false);
    expect(sameStat(stat, { ...stat, ino: "0", mtimeMs: 2000 })).toBe(false);
  });
});
