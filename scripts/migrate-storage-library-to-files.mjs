/**
 * One-time migration: renames the `library/` storage directory to `files/`
 * for each user directory under FILES_ROOT.
 *
 * Run after deploying the code that renames STORAGE_DIRECTORIES.library → .files.
 * Safe to re-run — skips users whose `files/` directory already exists.
 *
 * Usage:
 *   FILES_ROOT=./.data/files node scripts/migrate-storage-library-to-files.mjs
 */

import { rename, readdir, access } from "node:fs/promises";
import path from "node:path";

const filesRoot = process.env.FILES_ROOT;

if (!filesRoot) {
  console.error("Error: FILES_ROOT env var is required.");
  process.exit(1);
}

const resolved = path.resolve(filesRoot);
const libraryDir = path.join(resolved, "library");
const filesDir = path.join(resolved, "files");

const exists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false);

if (!(await exists(libraryDir))) {
  console.log("No library/ directory found — nothing to migrate.");
  process.exit(0);
}

if (await exists(filesDir)) {
  console.log("files/ directory already exists — skipping rename.");
  process.exit(0);
}

await rename(libraryDir, filesDir);
console.log(`Renamed ${libraryDir} → ${filesDir}`);
