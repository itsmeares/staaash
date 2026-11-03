import { randomUUID } from "node:crypto";
import { getPrisma } from "@staaash/db/client";
import { readArchiveSelection } from "@staaash/db/archive-selection";
import { findOrCreateZipArchive } from "@staaash/db/zip-archives";
import { beforeAll, describe, expect, inject, it } from "vite-plus/test";
import { assertIsolatedPostgresTestTarget } from "../vitest.postgres.global";

const db = getPrisma();
beforeAll(() =>
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  }),
);
const fixture = async () => {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `${id}@archive.test`,
      storageId: id,
      passwordHash: "fake",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: id, name: "Documents" },
  });
  const request = async () => {
    const selection = await readArchiveSelection(id, [], [folder.id]);
    return findOrCreateZipArchive({
      userId: id,
      contentKey: selection.contentKey,
      idsJson: { fileIds: [], folderIds: [folder.id] },
      expiresAt: new Date(Date.now() + 86400000),
      sourceSizeBytes: 0n,
    });
  };
  return { id, folder, request };
};

describe("archive cache with PostgreSQL", () => {
  it("reuses unchanged folders and rebuilds after nested uploads and edits", async () => {
    const { id, folder, request } = await fixture();
    const first = await request();
    await db.zipArchive.update({
      where: { id: first.archive.id },
      data: { status: "ready" },
    });
    expect((await request()).archive.id).toBe(first.archive.id);
    const child = await db.folder.create({
      data: { ownerUserId: id, parentId: folder.id, name: "Nested" },
    });
    const withEmpty = await request();
    expect(withEmpty.archive.id).not.toBe(first.archive.id);
    const file = await db.file.create({
      data: {
        ownerUserId: id,
        folderId: child.id,
        originalName: "hello.txt",
        storageKey: `files/${id}/hello.txt`,
        mimeType: "text/plain",
        sizeBytes: 4n,
        contentChecksum: "aaaa",
      },
    });
    const uploaded = await request();
    expect(uploaded.archive.id).not.toBe(withEmpty.archive.id);
    expect((await request()).archive.id).toBe(uploaded.archive.id);
    await db.folder.update({
      where: { id: child.id },
      data: { color: "blue" },
    });
    expect((await request()).archive.id).toBe(uploaded.archive.id);
    for (const data of [
      { contentChecksum: "bbbb" },
      { originalName: "renamed.txt" },
      { folderId: folder.id },
      { deletedAt: new Date() },
      { deletedAt: null },
    ]) {
      const before = await request();
      await db.file.update({ where: { id: file.id }, data });
      expect((await request()).archive.id).not.toBe(before.archive.id);
    }
    await db.file.update({
      where: { id: file.id },
      data: { storageStatus: "missing" },
    });
    await expect(request()).rejects.toThrow("missing or unavailable");
  });
  it("creates one archive and one job for concurrent requests", async () => {
    const { request } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => request()),
    );
    const ids = new Set(results.map((result) => result.archive.id));
    expect(ids.size).toBe(1);
    expect(
      await db.backgroundJob.count({
        where: { dedupeKey: `zip.archive.generate:${results[0]!.archive.id}` },
      }),
    ).toBe(1);
  });
  it("keeps expired records and bytes attached to their old ID", async () => {
    const { request } = await fixture();
    const old = await request();
    await db.zipArchive.update({
      where: { id: old.archive.id },
      data: {
        status: "ready",
        expiresAt: new Date(0),
        storageKey: `archives/${old.archive.id}.zip`,
      },
    });
    const fresh = await request();
    expect(fresh.archive.id).not.toBe(old.archive.id);
    expect(
      await db.zipArchive.findUniqueOrThrow({ where: { id: old.archive.id } }),
    ).toMatchObject({
      status: "ready",
      storageKey: `archives/${old.archive.id}.zip`,
    });
    expect((await request()).archive.id).toBe(fresh.archive.id);
  });
  it("repairs a queued archive whose request stopped before scheduling", async () => {
    const { request } = await fixture();
    const first = await request();
    await db.backgroundJob.deleteMany({
      where: { dedupeKey: `zip.archive.generate:${first.archive.id}` },
    });
    expect((await request()).archive.id).toBe(first.archive.id);
    expect(
      await db.backgroundJob.count({
        where: { dedupeKey: `zip.archive.generate:${first.archive.id}` },
      }),
    ).toBe(1);
  });
  it("rolls back the archive when job creation fails", async () => {
    const { id, request } = await fixture();
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_archive_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'archive queue test failure'; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER reject_archive_test_job BEFORE INSERT ON "BackgroundJob" FOR EACH ROW EXECUTE FUNCTION reject_archive_test_job()`,
    );
    try {
      await expect(request()).rejects.toThrow("archive queue test failure");
      expect(await db.zipArchive.count({ where: { userId: id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER reject_archive_test_job ON "BackgroundJob"`,
      );
      await db.$executeRawUnsafe(`DROP FUNCTION reject_archive_test_job()`);
    }
    expect((await request()).created).toBe(true);
  });
});
