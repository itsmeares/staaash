import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const dryRun = process.argv.includes("--dry-run");

const explicitTargets = [
  ".cache",
  ".eslintcache",
  ".parcel-cache",
  ".tmp",
  ".turbo",
  ".vite",
  "coverage",
  "playwright-report",
  "test-results",
  "apps/web/.next",
  "apps/web/.tmp",
  "apps/web/.turbo",
  "apps/web/coverage",
  "apps/web/playwright-report",
  "apps/web/test-results",
  "apps/worker/.turbo",
  "apps/worker/coverage",
  "apps/worker/dist",
  "packages/config/.turbo",
  "packages/config/coverage",
  "packages/config/dist",
  "packages/db/.turbo",
  "packages/db/coverage",
  "packages/db/dist",
];

const skippedDirectoryNames = new Set([
  ".data",
  ".git",
  ".next",
  ".turbo",
  "node_modules",
]);

const ensurePathWithinRepo = (targetPath) => {
  const relativePath = path.relative(repoRoot, targetPath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `Refusing to delete a path outside the repository: ${targetPath}`,
    );
  }
};

const repoPath = (targetPath) => path.resolve(repoRoot, targetPath);

const deleteTarget = async (targetPath) => {
  ensurePathWithinRepo(targetPath);

  if (!existsSync(targetPath)) {
    return;
  }

  const displayPath = path.relative(repoRoot, targetPath);
  console.log(`${dryRun ? "Would delete" : "Deleted"} ${displayPath}`);

  if (!dryRun) {
    await rm(targetPath, { recursive: true, force: true });
  }
};

const findTsBuildInfoFiles = async (directoryPath) => {
  const files = [];
  const entries = await readdir(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      if (skippedDirectoryNames.has(entry.name)) {
        continue;
      }

      files.push(...(await findTsBuildInfoFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".tsbuildinfo")) {
      files.push(entryPath);
    }
  }

  return files;
};

for (const target of explicitTargets) {
  await deleteTarget(repoPath(target));
}

for (const target of await findTsBuildInfoFiles(repoRoot)) {
  await deleteTarget(target);
}

console.log(
  dryRun ? "Cache cleanup dry run complete." : "Cache cleanup complete.",
);
