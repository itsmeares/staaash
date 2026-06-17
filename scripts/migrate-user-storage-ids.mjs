import path from "node:path";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";

import pg from "pg";

const { Client } = pg;

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const dryRun = args.has("--dry-run") || !apply;

if (args.has("--help")) {
  console.log(`
Usage:
  node scripts/migrate-user-storage-ids.mjs --dry-run
  node scripts/migrate-user-storage-ids.mjs --apply

Moves legacy files/<username> and .trash/<username> directories to each user's
stable storageId, then rewrites File.storageKey prefixes. Defaults to dry-run.
`);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const storageRoot = path.resolve(
  process.env.UPLOAD_LOCATION?.trim() || "./.data/files",
);

const resolveWithinRoot = (...segments) => {
  const resolved = path.resolve(storageRoot, ...segments);

  if (
    resolved !== storageRoot &&
    !resolved.startsWith(`${storageRoot}${path.sep}`)
  ) {
    throw new Error(`Refusing path outside storage root: ${resolved}`);
  }

  return resolved;
};

const pathExists = async (target) => {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const mergeDirectory = async (from, to) => {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (await pathExists(target)) {
      const [sourceStat, targetStat] = await Promise.all([
        stat(source),
        stat(target),
      ]);

      if (sourceStat.isDirectory() && targetStat.isDirectory()) {
        await mergeDirectory(source, target);
        continue;
      }

      throw new Error(`Refusing to overwrite existing path: ${target}`);
    }

    await rename(source, target);
  }

  await rm(from, { recursive: true, force: true });
};

const moveUserRoot = async ({ kind, oldName, storageId }) => {
  const oldPath = resolveWithinRoot(kind, oldName);
  const newPath = resolveWithinRoot(kind, storageId);

  if (oldPath === newPath) {
    return { moved: false, reason: "same-path" };
  }

  if (!(await pathExists(oldPath))) {
    if (apply) {
      await mkdir(newPath, { recursive: true });
    }
    return { moved: false, reason: "old-missing" };
  }

  if (dryRun) {
    return {
      moved: true,
      reason: (await pathExists(newPath)) ? "merge" : "rename",
      from: oldPath,
      to: newPath,
    };
  }

  if (await pathExists(newPath)) {
    await mergeDirectory(oldPath, newPath);
  } else {
    await mkdir(path.dirname(newPath), { recursive: true });
    await rename(oldPath, newPath);
  }

  return { moved: true, from: oldPath, to: newPath };
};

const rewriteStorageKeys = async ({ client, userId, oldName, storageId }) => {
  const files = await client.query(
    `SELECT "id", "storageKey" FROM "File" WHERE "ownerUserId" = $1`,
    [userId],
  );
  const updates = [];

  for (const row of files.rows) {
    const current = row.storageKey;
    const next = current
      .replace(`files/${oldName}/`, `files/${storageId}/`)
      .replace(`.trash/${oldName}/`, `.trash/${storageId}/`);

    if (next !== current) {
      updates.push({ id: row.id, current, next });
    }
  }

  if (apply) {
    for (const update of updates) {
      await client.query(
        `UPDATE "File" SET "storageKey" = $1 WHERE "id" = $2`,
        [update.next, update.id],
      );
    }
  }

  return updates;
};

const main = async () => {
  console.log(
    `${dryRun ? "Dry run" : "Apply"} user storageId migration at ${storageRoot}`,
  );

  if (!existsSync(storageRoot)) {
    throw new Error(`Storage root does not exist: ${storageRoot}`);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const mapping = await client.query(
      `SELECT "userId", "oldUsername", "storageId", "migratedAt"
       FROM "_UserStorageMigration"
       ORDER BY "oldUsername" ASC`,
    );

    if (mapping.rows.length === 0) {
      console.log("No storage mappings found.");
      return;
    }

    let movedRoots = 0;
    let rewrittenKeys = 0;

    for (const row of mapping.rows) {
      const userId = row.userId;
      const oldName = row.oldUsername;
      const storageId = row.storageId;

      console.log(`\n${oldName} -> ${storageId}`);

      for (const kind of ["files", ".trash"]) {
        const move = await moveUserRoot({ kind, oldName, storageId });
        if (move.moved) {
          movedRoots += 1;
          console.log(`  ${kind}: ${move.reason ?? "moved"}`);
          console.log(`    ${move.from}`);
          console.log(`    ${move.to}`);
        } else {
          console.log(`  ${kind}: ${move.reason}`);
        }
      }

      const updates = await rewriteStorageKeys({
        client,
        userId,
        oldName,
        storageId,
      });
      rewrittenKeys += updates.length;
      console.log(`  file keys: ${updates.length}`);

      if (apply) {
        await client.query(
          `UPDATE "_UserStorageMigration" SET "migratedAt" = NOW() WHERE "userId" = $1`,
          [userId],
        );
      }
    }

    console.log(
      `\nDone. roots=${movedRoots} fileKeys=${rewrittenKeys} mode=${
        dryRun ? "dry-run" : "apply"
      }`,
    );
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
