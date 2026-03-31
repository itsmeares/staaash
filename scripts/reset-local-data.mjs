import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const envFilePath = path.join(repoRoot, ".env");

const parseDotEnv = async (filePath) => {
  if (!existsSync(filePath)) {
    return {};
  }

  const fileContents = await readFile(filePath, "utf8");
  const entries = {};

  for (const rawLine of fileContents.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value.replace(/^(['"])(.*)\1$/u, "$2");
  }

  return entries;
};

const ensurePathWithinRepo = (targetPath) => {
  const relativePath = path.relative(repoRoot, targetPath);

  if (
    relativePath.startsWith("..") ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `Refusing to delete a path outside the repository: ${targetPath}`,
    );
  }
};

const toAbsoluteRepoPath = (candidatePath) =>
  path.isAbsolute(candidatePath)
    ? path.resolve(candidatePath)
    : path.resolve(repoRoot, candidatePath);

const envValues = await parseDotEnv(envFilePath);
const configuredFilesRoot = envValues.FILES_ROOT
  ? toAbsoluteRepoPath(envValues.FILES_ROOT)
  : null;

const resetTargets = new Set(
  [
    configuredFilesRoot,
    path.resolve(repoRoot, ".data/files"),
    path.resolve(repoRoot, "apps/web/.data/files"),
    path.resolve(repoRoot, "apps/worker/.data/files"),
  ].filter(Boolean),
);

for (const targetPath of resetTargets) {
  ensurePathWithinRepo(targetPath);

  if (!existsSync(targetPath)) {
    continue;
  }

  await rm(targetPath, { recursive: true, force: true });
  console.log(`Deleted ${path.relative(repoRoot, targetPath)}`);
}

const resetCommand =
  "pnpm --filter @staaash/db exec prisma db push --force-reset";
const childProcessEnv = {
  ...process.env,
  ...envValues,
};

if (process.platform === "win32") {
  execFileSync(
    process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", resetCommand],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: childProcessEnv,
    },
  );
} else {
  execFileSync(
    "pnpm",
    ["--filter", "@staaash/db", "exec", "prisma", "db", "push", "--force-reset"],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: childProcessEnv,
    },
  );
}

console.log("Local data reset complete.");
