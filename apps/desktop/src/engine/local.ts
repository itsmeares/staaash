import { createHash } from "node:crypto";
import { createReadStream, type BigIntStats } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { joinRel } from "./names";

export type LocalEntry = {
  rel: string;
  type: "folder" | "file";
  size: number;
  mtimeMs: number;
  /** The disk's id for this file; survives renames. Too big for a number on Windows. */
  ino: string;
};

/** No id to go by: some disks have none, and older saved ids were rounded. */
export const UNKNOWN_INO = "0";

export type LocalScan = {
  entries: LocalEntry[];
  /**
   * What the scan saw but leaves alone: ignored names, links, other special
   * files, and anything it could not read. `reason` is set when the person
   * should hear about it.
   */
  excluded: {
    rel: string;
    ino?: string;
    reason: string | null;
    unreadable?: boolean;
  }[];
};

/**
 * The value a plain lstat gives as `mtimeMs`, which bigint stats truncate.
 * Saved times must keep matching, or every file reads as changed.
 */
const mtimeMsOf = ({ mtimeNs }: BigIntStats) =>
  Number(mtimeNs / 1_000_000_000n) * 1000 +
  Number(mtimeNs % 1_000_000_000n) / 1e6;

const toEntry = (rel: string, stats: BigIntStats): LocalEntry => ({
  rel,
  type: stats.isDirectory() ? "folder" : "file",
  size: stats.isDirectory() ? 0 : Number(stats.size),
  mtimeMs: mtimeMsOf(stats),
  ino: String(stats.ino),
});

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;

/**
 * Every file and folder under `root`. A path is only missing from `entries`
 * when the disk said it is gone; everything the scan could not see clearly
 * goes to `excluded`, so it never reads as a deletion. An unreadable root
 * throws.
 */
export const scanLocal = async (
  root: string,
  ignore: (name: string) => boolean,
): Promise<LocalScan> => {
  const entries: LocalEntry[] = [];
  const excluded: LocalScan["excluded"] = [];
  const unreadable = (rel: string, error: unknown) =>
    // Moved or removed mid-scan: the next scan sees where it went.
    excluded.push({
      rel,
      unreadable: true,
      reason:
        code(error) === "ENOENT"
          ? null
          : `This can't be read (${code(error) ?? "error"}), so it is not synced.`,
    });
  // Directory entries come in several kinds.
  // fallow-ignore-next-line complexity
  const walk = async (dir: string, rel: string) => {
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (!rel) throw error;
      // The folder itself stays out too: its contents are unknown.
      entries.pop();
      unreadable(rel, error);
      return;
    }
    // One folder's entries are read together; folders go one at a time.
    const all = await Promise.all(
      dirents.map((dirent) =>
        lstat(path.join(dir, dirent.name), { bigint: true }).then(
          (stats) => ({ dirent, stats, error: null }),
          (error: unknown) => ({ dirent, stats: null, error }),
        ),
      ),
    );
    for (const { dirent, stats, error } of all) {
      // Keep the name as the disk spells it; comparisons go through pathKey.
      const childRel = joinRel(rel, dirent.name);
      const full = path.join(dir, dirent.name);
      if (!stats) {
        unreadable(childRel, error);
        continue;
      }
      // Checked on the lstat result: the entry may have changed since readdir.
      if (ignore(dirent.name) || stats.isSymbolicLink()) {
        excluded.push({
          rel: childRel,
          ino: String(stats.ino),
          reason: stats.isSymbolicLink() ? "Links are not synced." : null,
        });
        continue;
      }
      if (!stats.isDirectory() && !stats.isFile()) {
        excluded.push({ rel: childRel, reason: null });
        continue;
      }
      entries.push(toEntry(childRel, stats));
      if (stats.isDirectory()) await walk(full, childRel);
    }
  };
  await walk(root, "");
  return { entries, excluded };
};

/** The current state of one path, or null when it is gone. */
export const statLocal = async (root: string, rel: string) => {
  try {
    const stats = await lstat(path.join(root, ...rel.split("/")), {
      bigint: true,
    });
    if (stats.isSymbolicLink()) return null;
    return toEntry(rel, stats);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
};

/** SHA-256 hex, the same checksum the server keeps. */
export const hashFile = async (file: string) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
};

export const sameStat = (
  a: Pick<LocalEntry, "size" | "mtimeMs" | "ino">,
  b: Pick<LocalEntry, "size" | "mtimeMs" | "ino">,
) => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;

export const localPath = (root: string, rel: string) =>
  path.join(root, ...rel.split("/"));
