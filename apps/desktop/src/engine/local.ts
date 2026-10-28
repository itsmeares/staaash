import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { joinRel } from "./names";

export type LocalEntry = {
  rel: string;
  type: "folder" | "file";
  size: number;
  mtimeMs: number;
  ino: number;
};

export type LocalScan = {
  entries: LocalEntry[];
  /** Symlinks and other things sync leaves alone, by relative path. */
  skipped: { rel: string; reason: string }[];
};

const toEntry = (
  rel: string,
  stats: Awaited<ReturnType<typeof lstat>>,
): LocalEntry => ({
  rel,
  type: stats.isDirectory() ? "folder" : "file",
  size: stats.isDirectory() ? 0 : Number(stats.size),
  mtimeMs: Number(stats.mtimeMs),
  ino: Number(stats.ino),
});

/**
 * Every file and folder under `root`. Unreadable folders throw: a folder that
 * looks empty because it could not be read must never look deleted.
 */
export const scanLocal = async (
  root: string,
  ignore: (name: string) => boolean,
): Promise<LocalScan> => {
  const entries: LocalEntry[] = [];
  const skipped: LocalScan["skipped"] = [];
  // Directory entries come in several kinds.
  // fallow-ignore-next-line complexity
  const walk = async (dir: string, rel: string) => {
    for (const dirent of await readdir(dir, { withFileTypes: true })) {
      if (ignore(dirent.name)) continue;
      // Keep the name as the disk spells it; comparisons go through pathKey.
      const childRel = joinRel(rel, dirent.name);
      const full = path.join(dir, dirent.name);
      if (dirent.isSymbolicLink()) {
        skipped.push({ rel: childRel, reason: "Links are not synced." });
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isFile()) continue;
      let stats;
      try {
        stats = await lstat(full);
      } catch (error) {
        // Removed between readdir and lstat; the next scan sees it gone.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      entries.push(toEntry(childRel, stats));
      if (stats.isDirectory()) await walk(full, childRel);
    }
  };
  await walk(root, "");
  return { entries, skipped };
};

/** The current state of one path, or null when it is gone. */
export const statLocal = async (root: string, rel: string) => {
  try {
    const stats = await lstat(path.join(root, ...rel.split("/")));
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
