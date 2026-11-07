import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { createPrismaFilesRepository } from "./repository";

it("finds exact active names within the owner and destination, honoring exclusions", async () => {
  const db = getPrisma();
  const repo = createPrismaFilesRepository(undefined, async () => false);
  const createOwner = () =>
    db.user.create({
      data: {
        email: `${randomUUID()}@conflicts.test`,
        storageId: randomUUID(),
        passwordHash: "test-only",
      },
    });
  const owner = await createOwner();
  const other = await createOwner();
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const elsewhere = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Elsewhere", parentId: root.id },
  });
  const createFile = (name: string, overrides = {}) =>
    db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId: root.id,
        originalName: name,
        storageKey: `files/${owner.storageId}/${randomUUID()}`,
        mimeType: "text/plain",
        sizeBytes: 10,
        ...overrides,
      },
    });
  const find = (name: string, exclusions = {}) =>
    repo.findActiveNameConflict({
      ownerUserId: owner.id,
      parentId: root.id,
      name,
      ...exclusions,
    });

  await createFile("report.txt", { ownerUserId: other.id });
  await createFile("report.txt", { folderId: elsewhere.id });
  await createFile("report.txt", { deletedAt: new Date() });
  await createFile("report.txt", { storageStatus: "missing" });
  await createFile("Report.txt");
  await createFile("report.txt.bak");
  await db.folder.create({
    data: {
      ownerUserId: owner.id,
      parentId: root.id,
      name: "report.txt",
      deletedAt: new Date(),
    },
  });
  expect(await find("report.txt")).toBeNull();

  const oldest = await createFile("report.txt", {
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  const newer = await createFile("report.txt", {
    createdAt: new Date("2026-01-02T00:00:00Z"),
  });
  expect(await find("report.txt")).toMatchObject({
    kind: "file",
    item: { id: oldest.id, ownerUserId: owner.id, name: "report.txt" },
  });
  expect(await find("report.txt", { excludeFileId: oldest.id })).toMatchObject({
    kind: "file",
    item: { id: newer.id },
  });

  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, parentId: root.id, name: "report.txt" },
  });
  expect(await find("report.txt")).toMatchObject({
    kind: "folder",
    item: { id: folder.id },
  });
  expect(
    await find("report.txt", { excludeFolderId: folder.id }),
  ).toMatchObject({ kind: "file", item: { id: oldest.id } });
  await db.file.deleteMany({ where: { id: { in: [oldest.id, newer.id] } } });
  expect(await find("report.txt", { excludeFolderId: folder.id })).toBeNull();
  expect(
    await repo.findActiveNameConflict({
      ownerUserId: other.id,
      parentId: elsewhere.id,
      name: "report.txt",
    }),
  ).toBeNull();
});

it("ignores letter case when the storage disk does", async () => {
  const db = getPrisma();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@conflicts.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const file = await db.file.create({
    data: {
      ownerUserId: owner.id,
      folderId: root.id,
      originalName: "Photo_1.JPG",
      storageKey: `files/${owner.storageId}/${randomUUID()}`,
      mimeType: "image/jpeg",
      sizeBytes: 10,
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, parentId: root.id, name: "Trips" },
  });
  const find = (ignoreCase: boolean, name: string, exclusions = {}) =>
    createPrismaFilesRepository(
      undefined,
      async () => ignoreCase,
    ).findActiveNameConflict({
      ownerUserId: owner.id,
      parentId: root.id,
      name,
      ...exclusions,
    });

  expect(await find(false, "photo_1.jpg")).toBeNull();
  expect(await find(true, "photo_1.jpg")).toMatchObject({
    kind: "file",
    item: { id: file.id },
  });
  expect(await find(true, "TRIPS")).toMatchObject({
    kind: "folder",
    item: { id: folder.id },
  });
  await db.file.create({
    data: {
      ownerUserId: owner.id,
      folderId: root.id,
      originalName: "PhotoX1.jpg",
      storageKey: `files/${owner.storageId}/${randomUUID()}`,
      mimeType: "image/jpeg",
      sizeBytes: 10,
    },
  });
  // A case-only rename does not clash with the item being renamed, and the
  // underscore does not match the X in PhotoX1.jpg.
  expect(
    await find(true, "photo_1.jpg", { excludeFileId: file.id }),
  ).toBeNull();
  // Percent signs and backslashes are plain characters, not wildcards.
  expect(await find(true, "photo%")).toBeNull();
  expect(await find(true, "photo\\_1.jpg")).toBeNull();
});
