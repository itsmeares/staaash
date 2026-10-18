import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, inject, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { rebuildFolderSizeTotals } from "@staaash/db/reconciliation";
import { getFolderSizeBytes } from "./folder-size";

async function tree() {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@tree-size.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const folder = (name: string, parentId: string | null = null) =>
    db.folder.create({ data: { ownerUserId: user.id, name, parentId } });
  const root = await folder("Files");
  const left = await folder("Left", root.id);
  const right = await folder("Right", root.id);
  const child = await folder("Child", left.id);
  const file = await db.file.create({
    data: {
      ownerUserId: user.id,
      folderId: child.id,
      originalName: "sample.txt",
      storageKey: randomUUID(),
      mimeType: "text/plain",
      sizeBytes: 20n,
    },
  });
  return { db, user, root, left, right, child, file };
}

it("moves complete branch totals and rolls metadata back with the totals", async () => {
  const { db, root, left, right, child, file } = await tree();
  await db.folder.update({
    where: { id: child.id },
    data: { parentId: right.id },
  });
  expect(await getFolderSizeBytes(left.id)).toBe(0);
  expect(await getFolderSizeBytes(right.id)).toBe(20);
  expect(await getFolderSizeBytes(root.id)).toBe(20);
  await expect(
    db.$transaction(async (tx) => {
      await tx.file.update({
        where: { id: file.id },
        data: { sizeBytes: 50n },
      });
      await tx.folder.update({
        where: { id: child.id },
        data: { parentId: left.id },
      });
      throw new Error("stop");
    }),
  ).rejects.toThrow("stop");
  expect(await getFolderSizeBytes(right.id)).toBe(20);
  expect(await getFolderSizeBytes(left.id)).toBe(0);
  await db.file.update({
    where: { id: file.id },
    data: { folderId: left.id, sizeBytes: 7n },
  });
  expect(await getFolderSizeBytes(right.id)).toBe(0);
  expect(await getFolderSizeBytes(root.id)).toBe(7);
  await db.file.delete({ where: { id: file.id } });
  expect(await getFolderSizeBytes(root.id)).toBe(0);
});

for (const foldersFirst of [true, false]) {
  it(`keeps exact totals through trash and restore with ${foldersFirst ? "folders" : "files"} written first`, async () => {
    const { db, root, left, child, file } = await tree();
    const write = async (deletedAt: Date | null) =>
      db.$transaction(async (tx) => {
        const folders = () =>
          tx.folder.updateMany({
            where: { id: { in: [left.id, child.id] } },
            data: { deletedAt },
          });
        const files = () =>
          tx.file.update({ where: { id: file.id }, data: { deletedAt } });
        if (foldersFirst) {
          await folders();
          await files();
        } else {
          await files();
          await folders();
        }
      });
    await write(new Date());
    expect(await getFolderSizeBytes(root.id)).toBe(0);
    expect(await getFolderSizeBytes(left.id)).toBe(0);
    await write(null);
    expect(await getFolderSizeBytes(root.id)).toBe(20);
    expect(await getFolderSizeBytes(left.id)).toBe(20);
    expect(await getFolderSizeBytes(child.id)).toBe(20);
  });
}

it("keeps parallel file changes exact and ignores name-only and missing-status changes", async () => {
  const { db, user, root, child, file } = await tree();
  await Promise.all(
    Array.from({ length: 12 }, (_, n) =>
      db.file.create({
        data: {
          ownerUserId: user.id,
          folderId: child.id,
          originalName: `parallel-${n}.txt`,
          storageKey: randomUUID(),
          mimeType: "text/plain",
          sizeBytes: 3n,
        },
      }),
    ),
  );
  expect(await getFolderSizeBytes(root.id)).toBe(56);
  const before =
    await db.$queryRaw`SELECT xmin::text FROM "Folder" WHERE id=${root.id}`;
  await db.file.update({
    where: { id: file.id },
    data: { originalName: "renamed.txt", storageStatus: "missing" },
  });
  expect(
    await db.$queryRaw`SELECT xmin::text FROM "Folder" WHERE id=${root.id}`,
  ).toEqual(before);
  expect(await getFolderSizeBytes(root.id)).toBe(56);
});

it("serializes a hierarchy change with simultaneous uploads", async () => {
  const { db, user, root, left, right, child } = await tree();
  await Promise.all([
    db.folder.update({ where: { id: child.id }, data: { parentId: right.id } }),
    ...Array.from({ length: 10 }, (_, n) =>
      db.file.create({
        data: {
          ownerUserId: user.id,
          folderId: child.id,
          originalName: `racing-${n}.txt`,
          storageKey: randomUUID(),
          mimeType: "text/plain",
          sizeBytes: 4n,
        },
      }),
    ),
  ]);
  expect(await getFolderSizeBytes(root.id)).toBe(60);
  expect(await getFolderSizeBytes(left.id)).toBe(0);
  expect(await getFolderSizeBytes(right.id)).toBe(60);
  await db.folder.update({
    where: { id: root.id },
    data: { treeSizeBytes: 7n },
  });
  await rebuildFolderSizeTotals();
  expect(await getFolderSizeBytes(root.id)).toBe(60);
});

it("commits simultaneous mixed file and folder writes in either order", async () => {
  const first = await tree();
  const second = await tree();
  const clients = [0, 1].map(
    () => new Client({ connectionString: inject("postgresDatabaseUrl") }),
  );
  await Promise.all(clients.map((client) => client.connect()));
  try {
    for (const orders of [
      [true, true],
      [false, false],
      [true, false],
    ]) {
      const results = await Promise.allSettled(
        clients.map(async (client, n) => {
          const item = [first, second][n]!;
          await client.query("BEGIN");
          await client.query("SET LOCAL statement_timeout = '4s'");
          const file = () =>
            client.query(
              'UPDATE "File" SET "sizeBytes" = "sizeBytes" + 1 WHERE id = $1',
              [item.file.id],
            );
          const folder = () =>
            client.query('UPDATE "Folder" SET "parentId" = $1 WHERE id = $2', [
              item.right.id,
              item.child.id,
            ]);
          if (orders[n]) {
            await file();
            await client.query("SELECT pg_sleep(0.1)");
            await folder();
          } else {
            await folder();
            await client.query("SELECT pg_sleep(0.1)");
            await file();
          }
          await client.query("COMMIT");
        }),
      );
      expect(results).toEqual([
        { status: "fulfilled", value: undefined },
        { status: "fulfilled", value: undefined },
      ]);
    }
    for (const item of [first, second]) {
      expect(await getFolderSizeBytes(item.root.id)).toBe(23);
      expect(await getFolderSizeBytes(item.left.id)).toBe(0);
      expect(await getFolderSizeBytes(item.right.id)).toBe(23);
    }
  } finally {
    await Promise.all(
      clients.map(async (client) => {
        await client.query("ROLLBACK");
        await client.end();
      }),
    );
  }
});

it("backfills old nested metadata without changing revisions or timestamps", async () => {
  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  const schema = `size_migration_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(
      `CREATE TABLE "Folder" (id TEXT PRIMARY KEY, "parentId" TEXT, "deletedAt" TIMESTAMP, "storageRevision" INT DEFAULT 7, "updatedAt" TIMESTAMP DEFAULT '2026-01-01')`,
    );
    await client.query(
      `CREATE TABLE "File" (id TEXT PRIMARY KEY, "folderId" TEXT, "sizeBytes" BIGINT, "deletedAt" TIMESTAMP)`,
    );
    await client.query(
      `INSERT INTO "Folder"(id,"parentId","deletedAt") VALUES ('root',NULL,NULL),('child','root',NULL),('trash','root',NOW())`,
    );
    await client.query(
      `INSERT INTO "File" VALUES ('large','child',9007199254740993,NULL),('direct','root',7,NULL),('deleted','child',50,NOW()),('hidden','trash',100,NULL)`,
    );
    const migration = await readFile(
      new URL(
        "../../../../packages/db/prisma/migrations/20261019000000_folder_tree_sizes/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await client.query(migration);
    expect(
      (
        await client.query(
          `SELECT id,"treeSizeBytes"::text AS bytes,"storageRevision","updatedAt"::text AS at FROM "Folder" ORDER BY id`,
        )
      ).rows,
    ).toEqual([
      {
        id: "child",
        bytes: "9007199254740993",
        storageRevision: 7,
        at: "2026-01-01 00:00:00",
      },
      {
        id: "root",
        bytes: "9007199254741000",
        storageRevision: 7,
        at: "2026-01-01 00:00:00",
      },
      {
        id: "trash",
        bytes: "0",
        storageRevision: 7,
        at: "2026-01-01 00:00:00",
      },
    ]);
    await client.query("BEGIN");
    await client.query(`UPDATE "File" SET "sizeBytes"=3 WHERE id='large'`);
    expect(
      (
        await client.query(
          `SELECT "treeSizeBytes"::text AS bytes FROM "Folder" WHERE id='root'`,
        )
      ).rows[0].bytes,
    ).toBe("10");
    await client.query("ROLLBACK");
    expect(
      (
        await client.query(
          `SELECT "treeSizeBytes"::text AS bytes FROM "Folder" WHERE id='root'`,
        )
      ).rows[0].bytes,
    ).toBe("9007199254741000");
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});

it("adds up live files in a folder and every folder below it", async () => {
  const db = getPrisma();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@folder-size.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const folder = (
    name: string,
    parentId: string | null = null,
    deletedAt: Date | null = null,
  ) =>
    db.folder.create({
      data: { ownerUserId: owner.id, name, parentId, deletedAt },
    });
  const file = (
    folderId: string,
    sizeBytes: number,
    deletedAt: Date | null = null,
  ) =>
    db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId,
        originalName: `${randomUUID()}.bin`,
        storageKey: `files/${owner.id}/${randomUUID()}`,
        mimeType: "application/octet-stream",
        sizeBytes,
        deletedAt,
      },
    });
  const photos = await folder("Photos");
  const lisbon = await folder("Lisbon", photos.id);
  const trashed = await folder("Old", photos.id, new Date());
  const other = await folder("Other");
  await file(photos.id, 100);
  await file(lisbon.id, 20);
  await file(lisbon.id, 3);
  await file(lisbon.id, 5000, new Date());
  await file(trashed.id, 7000);
  await file(other.id, 9000);

  expect(await getFolderSizeBytes(photos.id)).toBe(123);
  expect(await getFolderSizeBytes(lisbon.id)).toBe(23);
  expect(await getFolderSizeBytes(trashed.id)).toBe(0);
});
