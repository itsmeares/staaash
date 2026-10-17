import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, inject, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { createPrismaFilesRepository } from "./repository";

it("keeps indexed candidates complete for literal normalized name matching across writes", async () => {
  const db = getPrisma();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@search.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const other = await db.user.create({
    data: {
      email: `${randomUUID()}@search.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Finance" },
  });
  for (const [index, name] of [
    "Résumé.TXT",
    "resume-notes.txt",
    "budget.xlsx",
    "100%_done.txt",
    "a\\b.txt",
    "İstanbul.txt",
    "Łódź.txt",
    "ﬁle.txt",
    "ＡＢＣ.txt",
    "e\u0301cho.txt",
  ].entries()) {
    await db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId: index % 2 ? folder.id : null,
        originalName: name,
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
      },
    });
  }
  for (const overrides of [
    { ownerUserId: other.id },
    { deletedAt: new Date() },
    { storageStatus: "missing" as const },
  ]) {
    await db.file.create({
      data: {
        ownerUserId: owner.id,
        originalName: "Résumé.TXT",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
        ...overrides,
      },
    });
  }
  const repository = createPrismaFilesRepository();
  for (const query of [
    "resume",
    "RÉSUMÉ",
    "e",
    "re",
    "xlsx",
    "none",
    "%",
    "_",
    "100%_",
    "a\\b",
    "istanbul",
    "Ł",
    "ﬁ",
    "ＡＢＣ",
    "e\u0301",
  ]) {
    for (const folderIds of [[], [folder.id]]) {
      const expected = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM "File" WHERE "ownerUserId" = ${owner.id}
        AND "deletedAt" IS NULL AND "storageStatus" = 'available'::"FileStorageStatus"
        AND (strpos(unaccent(lower("originalName")), unaccent(lower(${query}))) > 0 OR "folderId" = ANY(${folderIds}::text[]))
      `;
      expect(
        (await repository.searchFilesByOwner(owner.id, query, folderIds))
          .map((file) => file.id)
          .sort(),
      ).toEqual(expected.map((file) => file.id).sort());
    }
  }
  const renamed = await db.file.findFirstOrThrow({
    where: {
      ownerUserId: owner.id,
      originalName: "Résumé.TXT",
      deletedAt: null,
      storageStatus: "available",
    },
  });
  await db.file.update({
    where: { id: renamed.id },
    data: { originalName: "Café.txt", searchName: "forged" },
  });
  expect(
    (await repository.searchFilesByOwner(owner.id, "cafe", [])).map(
      (file) => file.id,
    ),
  ).toEqual([renamed.id]);
  expect(await repository.searchFilesByOwner(owner.id, "forged", [])).toEqual(
    [],
  );
  await db.file.update({
    where: { id: renamed.id },
    data: { deletedAt: new Date() },
  });
  expect(await repository.searchFilesByOwner(owner.id, "cafe", [])).toEqual([]);
  await db.file.update({
    where: { id: renamed.id },
    data: { deletedAt: null, storageStatus: "missing" },
  });
  expect(await repository.searchFilesByOwner(owner.id, "cafe", [])).toEqual([]);
  await db.file.update({
    where: { id: renamed.id },
    data: { storageStatus: "available", folderId: folder.id },
  });
  expect(
    (await repository.searchFilesByOwner(owner.id, "cafe", [])).map(
      (file) => file.id,
    ),
  ).toEqual([renamed.id]);
  expect(
    await repository.listFilesByIds(other.id, [renamed.id], {
      includeDeleted: true,
      includeMissing: true,
    }),
  ).toEqual([]);
  expect(await repository.listFilesByIds(owner.id, [])).toEqual([]);
});

it("backfills legacy names without changing revisions, and rolls back renames atomically", async () => {
  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  const schema = `search_migration_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(
      `CREATE TABLE "File" (id TEXT PRIMARY KEY, "originalName" TEXT NOT NULL, "deletedAt" TIMESTAMP, "storageStatus" public."FileStorageStatus" DEFAULT 'available', "updatedAt" TIMESTAMP DEFAULT '2026-01-01', "storageRevision" INT DEFAULT 7)`,
    );
    await client.query(
      `INSERT INTO "File"(id,"originalName") VALUES ('legacy','Résumé.TXT')`,
    );
    const migration = await readFile(
      new URL(
        "../../../../packages/db/prisma/migrations/20261017000000_file_search_name/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await client.query(migration);
    expect(
      (
        await client.query(
          `SELECT "searchName", "storageRevision", "updatedAt"::text AS "updatedAt" FROM "File"`,
        )
      ).rows,
    ).toEqual([
      {
        searchName: "resume.txt",
        storageRevision: 7,
        updatedAt: "2026-01-01 00:00:00",
      },
    ]);
    await client.query(
      `INSERT INTO "File"(id,"originalName","searchName") VALUES ('inserted','Café.txt','forged')`,
    );
    expect(
      (
        await client.query(
          `SELECT "searchName" FROM "File" WHERE id='inserted'`,
        )
      ).rows,
    ).toEqual([{ searchName: "cafe.txt" }]);
    await client.query("BEGIN");
    await client.query(
      `UPDATE "File" SET "originalName"='new.txt' WHERE id='legacy'`,
    );
    expect(
      (await client.query(`SELECT "searchName" FROM "File" WHERE id='legacy'`))
        .rows,
    ).toEqual([{ searchName: "new.txt" }]);
    await client.query("ROLLBACK");
    expect(
      (
        await client.query(
          `SELECT "originalName", "searchName" FROM "File" WHERE id='legacy'`,
        )
      ).rows,
    ).toEqual([{ originalName: "Résumé.TXT", searchName: "resume.txt" }]);
    const index = await client.query(
      `SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='File_searchName_trgm_idx'`,
      [schema],
    );
    expect(index.rows[0].indexdef).toContain("gin_trgm_ops");
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
