import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, inject, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { verifyCommittedStorageUsage } from "@staaash/db/reconciliation";
import { getUserStorageUsed, withUserQuotaWrite } from "@/server/user-storage";
import { reserveResumableSession } from "./admission";

const db = getPrisma();
const user = () =>
  db.user.create({
    data: {
      email: `${randomUUID()}@usage.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
const file = (ownerUserId: string, sizeBytes: bigint) => ({
  ownerUserId,
  sizeBytes,
  originalName: `${randomUUID()}.txt`,
  storageKey: randomUUID(),
  mimeType: "text/plain",
});
const stored = async (id: string) =>
  (
    await db.user.findUniqueOrThrow({
      where: { id },
      select: { committedStorageBytes: true },
    })
  ).committedStorageBytes;

it("counts bulk writes, replacements, and owner changes with exact bigint values", async () => {
  const [a, b] = await Promise.all([user(), user()]);
  const first = file(a.id, 9_007_199_254_740_993n);
  await db.file.createMany({ data: [first, file(a.id, 7n), file(b.id, 11n)] });
  expect(await stored(a.id)).toBe(9_007_199_254_741_000n);
  await db.file.update({
    where: { storageKey: first.storageKey },
    data: { sizeBytes: 13n, ownerUserId: b.id },
  });
  expect(await stored(a.id)).toBe(7n);
  expect(await stored(b.id)).toBe(24n);
  await db.file.deleteMany({ where: { ownerUserId: b.id } });
  expect(await stored(b.id)).toBe(0n);
  await verifyCommittedStorageUsage();
});

it("keeps trash and missing bytes, without updating the user for name or status changes", async () => {
  const owner = await user();
  const created = await db.file.create({ data: file(owner.id, 20n) });
  const xmin = () =>
    db.$queryRaw<
      Array<{ xmin: string }>
    >`SELECT xmin::text FROM "User" WHERE id=${owner.id}`;
  const before = await xmin();
  await db.file.update({
    where: { id: created.id },
    data: {
      originalName: "new.txt",
      deletedAt: new Date(),
      storageStatus: "missing",
    },
  });
  expect(await xmin()).toEqual(before);
  expect((await getUserStorageUsed(owner.id)).committedBytes).toBe(20n);
  await db.file.update({
    where: { id: created.id },
    data: { deletedAt: null, storageStatus: "available" },
  });
  expect(await stored(owner.id)).toBe(20n);
  await db.user.delete({ where: { id: owner.id } });
  expect(await db.file.findUnique({ where: { id: created.id } })).toBeNull();
});

it("rolls file metadata and usage back together, and rejects forged totals", async () => {
  const owner = await user();
  await expect(
    db.$transaction(async (tx) => {
      await tx.file.create({ data: file(owner.id, 15n) });
      expect(
        (await tx.user.findUniqueOrThrow({ where: { id: owner.id } }))
          .committedStorageBytes,
      ).toBe(15n);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await stored(owner.id)).toBe(0n);
  await expect(
    db.user.update({
      where: { id: owner.id },
      data: { committedStorageBytes: 500n },
    }),
  ).rejects.toThrow("maintained by file metadata");
});

it("serializes concurrent quota writes without overshooting", async () => {
  const owner = await user();
  await db.user.update({
    where: { id: owner.id },
    data: { storageLimitBytes: 100n },
  });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      withUserQuotaWrite({
        ownerUserId: owner.id,
        additionalBytes: 30n,
        callback: (tx) => tx.file.create({ data: file(owner.id, 30n) }),
      }),
    ),
  );
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(3);
  expect(await stored(owner.id)).toBe(90n);
  expect((await getUserStorageUsed(owner.id)).usedBytes).toBe(90n);
});

it("quarantines a mismatched counter and blocks both admission and file growth", async () => {
  const owner = await user();
  await db.file.create({ data: file(owner.id, 10n) });
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "User" DISABLE TRIGGER "User_protect_storage_usage"`;
    await tx.user.update({
      where: { id: owner.id },
      data: { committedStorageBytes: 1n },
    });
    await tx.$executeRaw`ALTER TABLE "User" ENABLE TRIGGER "User_protect_storage_usage"`;
  });
  await expect(verifyCommittedStorageUsage()).rejects.toThrow("does not match");
  expect(await stored(owner.id)).toBeNull();
  await expect(getUserStorageUsed(owner.id)).rejects.toMatchObject({
    code: "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE",
  });
  await expect(
    withUserQuotaWrite({
      ownerUserId: owner.id,
      additionalBytes: 1n,
      callback: (tx) => tx.file.create({ data: file(owner.id, 1n) }),
    }),
  ).rejects.toMatchObject({ code: "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE" });
  const id = randomUUID();
  await expect(
    reserveResumableSession({
      id,
      ownerUserId: owner.id,
      folderId: null,
      originalName: "blocked.txt",
      mimeType: "text/plain",
      totalSizeBytes: 1,
      expectedChecksum: null,
      protocolVersion: 2,
      chunkSizeBytes: 1,
      tmpPath: `/tmp/${id}`,
      conflictStrategy: "safeRename",
      expiresAt: new Date(Date.now() + 60000),
    }),
  ).rejects.toMatchObject({ code: "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE" });
  await expect(db.file.create({ data: file(owner.id, 1n) })).rejects.toThrow(
    "usage is unavailable",
  );
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`ALTER TABLE "User" DISABLE TRIGGER "User_protect_storage_usage"`;
    await tx.user.update({
      where: { id: owner.id },
      data: { committedStorageBytes: 10n },
    });
    await tx.$executeRaw`ALTER TABLE "User" ENABLE TRIGGER "User_protect_storage_usage"`;
  });
  await verifyCommittedStorageUsage();
});

it("backfills existing bytes without changing file metadata or user dates, including old-version writes", async () => {
  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  const schema = `usage_${randomUUID().replaceAll("-", "")}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`CREATE TABLE "User" (id TEXT PRIMARY KEY, "updatedAt" TIMESTAMP DEFAULT '2026-01-01');
      CREATE TABLE "File" (id TEXT PRIMARY KEY, "ownerUserId" TEXT REFERENCES "User"(id) ON DELETE CASCADE, "sizeBytes" BIGINT, "originalName" TEXT, "deletedAt" TIMESTAMP);
      CREATE TABLE "UploadSession" ("ownerUserId" TEXT, "status" TEXT, "stagingReleasedAt" TIMESTAMP);
      CREATE TABLE "StorageMutation" ("ownerUserId" TEXT, "reservedBytes" BIGINT);
      INSERT INTO "User"(id) VALUES ('a'),('b');
      INSERT INTO "File" VALUES ('one','a',10,'original',NULL),('two','a',20,'trashed',CURRENT_TIMESTAMP)`);
    const before = await client.query(
      `SELECT row_to_json(f) FROM "File" f ORDER BY id`,
    );
    const dates = await client.query(
      `SELECT "updatedAt"::text FROM "User" ORDER BY id`,
    );
    await client.query(
      await readFile(
        new URL(
          "../../../../packages/db/prisma/migrations/20261018000000_committed_storage_usage/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      (
        await client.query(
          `SELECT "committedStorageBytes"::text AS bytes FROM "User" ORDER BY id`,
        )
      ).rows,
    ).toEqual([{ bytes: "30" }, { bytes: "0" }]);
    expect(
      (await client.query(`SELECT row_to_json(f) FROM "File" f ORDER BY id`))
        .rows,
    ).toEqual(before.rows);
    expect(
      (await client.query(`SELECT "updatedAt"::text FROM "User" ORDER BY id`))
        .rows,
    ).toEqual(dates.rows);
    await client.query(
      `INSERT INTO "File" VALUES ('legacy-writer','a',5,'new',NULL)`,
    );
    expect(
      (
        await client.query(
          `SELECT "committedStorageBytes"::text AS bytes FROM "User" WHERE id='a'`,
        )
      ).rows,
    ).toEqual([{ bytes: "35" }]);
    await client.query(`TRUNCATE "File"`);
    expect(
      (
        await client.query(
          `SELECT "committedStorageBytes"::text AS bytes FROM "User" ORDER BY id`,
        )
      ).rows,
    ).toEqual([{ bytes: "0" }, { bytes: "0" }]);
  } finally {
    await client.query("ROLLBACK");
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
});
