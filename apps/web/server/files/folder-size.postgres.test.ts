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

it("rebuilds totals while a favorite transaction also changes a file", async () => {
  const { db, user, root, file } = await tree();
  const favoriteId = randomUUID();
  const writer = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  const rebuilder = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  await Promise.all([writer.connect(), rebuilder.connect()]);
  try {
    for (const client of [writer, rebuilder]) {
      await client.query("BEGIN");
      await client.query("SET LOCAL statement_timeout = '4s'");
    }
    await writer.query(
      'INSERT INTO "FavoriteFolder" (id, "userId", "folderId") VALUES ($1, $2, $3)',
      [favoriteId, user.id, root.id],
    );
    const pid = (await rebuilder.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid as number;
    let rebuilt = false;
    const rebuilding = rebuilder
      .query("SELECT staaash_rebuild_folder_sizes(ARRAY[$1]::text[])", [
        root.id,
      ])
      .then(() => rebuilder.query("COMMIT"))
      .then(() => {
        rebuilt = true;
      });
    const results = await Promise.allSettled([
      rebuilding,
      (async () => {
        let locked = false;
        for (let attempt = 0; attempt < 100 && !rebuilt; attempt++) {
          const locks = await writer.query(
            "SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND granted",
            [pid],
          );
          if (locks.rowCount) {
            locked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(rebuilt || locked).toBe(true);
        await writer.query('UPDATE "File" SET "sizeBytes" = 21 WHERE id = $1', [
          file.id,
        ]);
        await writer.query("COMMIT");
      })(),
    ]);
    expect(results).toEqual([
      { status: "fulfilled", value: undefined },
      { status: "fulfilled", value: undefined },
    ]);
    expect(await getFolderSizeBytes(root.id)).toBe(21);
    expect(
      await db.favoriteFolder.findUnique({ where: { id: favoriteId } }),
    ).not.toBeNull();
  } finally {
    await Promise.all(
      [writer, rebuilder].map(async (client) => {
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
      `CREATE TABLE "Folder" (id TEXT PRIMARY KEY, "parentId" TEXT, "deletedAt" TIMESTAMP, "storageRevision" INT DEFAULT 7, "updatedAt" TIMESTAMP DEFAULT '2026-01-01', "isFilesRoot" BOOLEAN DEFAULT false)`,
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
    await client.query(
      await readFile(
        new URL(
          "../../../../packages/db/prisma/migrations/20261019010000_scoped_folder_totals/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
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
    await client.query("BEGIN");
    await client.query(`UPDATE "Folder" SET "parentId"=NULL WHERE id='child'`);
    expect(
      (
        await client.query(
          `SELECT "treeSizeBytes"::text AS bytes FROM "Folder" WHERE id='root'`,
        )
      ).rows[0].bytes,
    ).toBe("7");
    expect(
      (
        await client.query(
          `SELECT "treeSizeBytes"::text AS bytes FROM "Folder" WHERE id='child'`,
        )
      ).rows[0].bytes,
    ).toBe("9007199254740993");
    await client.query("ROLLBACK");
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

const expectFreshTotals = async (ownerUserId: string) => {
  const wrong = await getPrisma().$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree(root_id, id) AS (
      SELECT id, id FROM "Folder" WHERE "ownerUserId" = ${ownerUserId} AND "deletedAt" IS NULL
      UNION
      SELECT tree.root_id, child.id FROM tree JOIN "Folder" child ON child."parentId" = tree.id WHERE child."deletedAt" IS NULL
    ), totals AS (
      SELECT tree.root_id, SUM(file."sizeBytes") AS bytes FROM tree JOIN "File" file ON file."folderId" = tree.id AND file."deletedAt" IS NULL GROUP BY tree.root_id
    )
    SELECT folder.id FROM "Folder" folder LEFT JOIN totals ON totals.root_id = folder.id
    WHERE folder."ownerUserId" = ${ownerUserId} AND folder."treeSizeBytes" <> COALESCE(totals.bytes, 0)
  `;
  expect(wrong).toEqual([]);
};

it("keeps mixed parent changes and old cycles exact", async () => {
  const { db, user, root, left, right, child } = await tree();
  await db.$executeRaw`UPDATE "Folder" SET "parentId" = CASE WHEN id = ${child.id} THEN ${right.id} ELSE ${left.id} END WHERE id IN (${child.id}, ${right.id})`;
  await expectFreshTotals(user.id);
  await db.folder.update({
    where: { id: left.id },
    data: { parentId: child.id },
  });
  await expectFreshTotals(user.id);
  await db.folder.update({
    where: { id: child.id },
    data: { parentId: root.id },
  });
  await expectFreshTotals(user.id);
  await db.folder.update({
    where: { id: child.id },
    data: { parentId: right.id },
  });
  await expectFreshTotals(user.id);
  await db.folder.delete({ where: { id: left.id } });
  await expectFreshTotals(user.id);
});

it("changes folders without reading unrelated files at the root or in another branch", async () => {
  const { db, user, root, left, right, child } = await tree();
  await db.file.createMany({
    data: Array.from({ length: 2000 }, (_, index) => ({
      ownerUserId: user.id,
      folderId: index < 1000 ? root.id : right.id,
      originalName: `${index}.txt`,
      storageKey: randomUUID(),
      mimeType: "text/plain",
      sizeBytes: 1,
    })),
  });
  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  await client.connect();
  try {
    for (const move of [true, false]) {
      await client.query("BEGIN");
      if (move)
        await client.query('UPDATE "Folder" SET "parentId"=$1 WHERE id=$2', [
          right.id,
          child.id,
        ]);
      else
        await client.query(
          'UPDATE "Folder" SET "deletedAt"=NOW() WHERE id=ANY($1::text[])',
          [[left.id, child.id]],
        );
      const reads = await client.query(
        `SELECT seq_tup_read + idx_tup_fetch AS reads FROM pg_stat_xact_user_tables WHERE relid='"File"'::regclass`,
      );
      expect(Number(reads.rows[0].reads)).toBe(0);
      const total = await client.query(
        'SELECT "treeSizeBytes"::text AS bytes FROM "Folder" WHERE id=$1',
        [root.id],
      );
      expect(total.rows[0].bytes).toBe(move ? "2020" : "2000");
      await client.query("ROLLBACK");
    }
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
  await expectFreshTotals(user.id);
});

it("matches fresh totals after overlapping moves and changes under deleted parents", async () => {
  const { db, user, root, left, right, child, file } = await tree();
  const folders = (ids: string[], deletedAt: Date | null) =>
    db.folder.updateMany({ where: { id: { in: ids } }, data: { deletedAt } });
  const steps = [
    () => folders([left.id, child.id], new Date()),
    () =>
      db.file.update({
        where: { id: file.id },
        data: { folderId: right.id, sizeBytes: 10n },
      }),
    () => folders([left.id, child.id], null),
    () =>
      db.file.update({
        where: { id: file.id },
        data: { folderId: child.id, sizeBytes: 99n },
      }),
    () => folders([left.id], new Date()),
    () => db.file.update({ where: { id: file.id }, data: { sizeBytes: 5n } }),
    () =>
      db.folder.update({
        where: { id: child.id },
        data: { parentId: right.id },
      }),
    () => folders([left.id], null),
    () =>
      db.file.update({
        where: { id: file.id },
        data: { deletedAt: new Date() },
      }),
    () => folders([right.id, child.id], new Date()),
    () => db.file.update({ where: { id: file.id }, data: { deletedAt: null } }),
    () => folders([right.id, child.id], null),
    () =>
      db.$executeRaw`UPDATE "Folder" SET "parentId" = CASE WHEN id = ${child.id} THEN ${root.id} ELSE ${left.id} END WHERE id IN (${child.id}, ${right.id})`,
    () => db.folder.delete({ where: { id: right.id } }),
    () => db.file.delete({ where: { id: file.id } }),
    () => db.folder.delete({ where: { id: child.id } }),
  ];
  for (const step of steps) {
    await step();
    await expectFreshTotals(user.id);
  }
});
