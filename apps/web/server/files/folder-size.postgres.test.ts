import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { getFolderSizeBytes } from "./folder-size";

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
