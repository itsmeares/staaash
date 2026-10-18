import { getRetrievalPage } from "./page";
import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";

it("returns only the owner's active favorites with paths, order and pins intact", async () => {
  const db = getPrisma();
  const createOwner = () =>
    db.user.create({
      data: {
        email: `${randomUUID()}@favorites.test`,
        storageId: randomUUID(),
        passwordHash: "test-only",
      },
    });
  const owner = await createOwner();
  const other = await createOwner();
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, parentId: root.id, name: "Projects" },
  });
  const createFile = (name: string, ownerUserId = owner.id) =>
    db.file.create({
      data: {
        ownerUserId,
        folderId: ownerUserId === owner.id ? folder.id : null,
        originalName: name,
        storageKey: `files/${ownerUserId}/${name}`,
        mimeType: "text/plain",
        sizeBytes: 128,
      },
    });
  const selected = await createFile("selected.txt");
  const missing = await createFile("missing.txt");
  const deleted = await createFile("deleted.txt");
  const foreign = await createFile("private.txt", other.id);
  await createFile("unrelated.txt");
  await db.file.update({
    where: { id: missing.id },
    data: { storageStatus: "missing" },
  });
  await db.file.update({
    where: { id: deleted.id },
    data: { deletedAt: new Date() },
  });
  const pinnedAt = new Date("2026-01-03T00:00:00Z");
  const earlier = new Date("2026-01-01T00:00:00Z");
  await db.favoriteFile.createMany({
    data: [selected, missing, deleted, foreign].map((file) => ({
      userId: owner.id,
      fileId: file.id,
      createdAt: earlier,
      quickAccessPinnedAt: file.id === selected.id ? pinnedAt : null,
    })),
  });
  await db.favoriteFolder.createMany({
    data: [root, folder].map((item) => ({
      userId: owner.id,
      folderId: item.id,
      createdAt: pinnedAt,
    })),
  });
  const favorites = (await getRetrievalPage(owner.id, "favorites")).items;
  expect(
    favorites.map((item) => [
      item.id,
      item.pathLabel,
      item.isFavorite,
      item.quickAccessPinnedAt,
    ]),
  ).toEqual([
    [folder.id, "Files / Projects", true, null],
    [selected.id, "Files / Projects / selected.txt", true, pinnedAt],
    [missing.id, "Files / Projects / missing.txt", true, null],
  ]);
  await db.favoriteFile.deleteMany({ where: { userId: owner.id } });
  await db.favoriteFolder.deleteMany({ where: { userId: owner.id } });
  expect((await getRetrievalPage(owner.id, "favorites")).items).toEqual([]);
});
