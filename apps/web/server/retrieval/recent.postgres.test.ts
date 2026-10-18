import { getRetrievalPage } from "./page";
import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { createRetrievalService } from "./service";

it("keeps what was last done with each item, trashed items included", async () => {
  const db = getPrisma();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@recent.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
      preferences: { create: {} },
    },
    include: { preferences: true },
  });
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, parentId: root.id, name: "Photos" },
  });
  const createFile = (name: string) =>
    db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId: folder.id,
        originalName: name,
        storageKey: `files/${owner.id}/${name}`,
        mimeType: "image/jpeg",
        sizeBytes: 128,
      },
    });
  const kept = await createFile("kept.jpg");
  const trashed = await createFile("trashed.jpg");
  // A row from before actions were kept.
  const old = await createFile("old.jpg");
  await db.recentFile.create({
    data: {
      userId: owner.id,
      fileId: old.id,
      lastInteractedAt: new Date("2026-01-01T00:00:00Z"),
    },
  });

  let clock = new Date("2026-02-01T10:00:00Z");
  const service = createRetrievalService({ now: () => clock });
  const actor = { actorUserId: owner.id, actorRole: "member" as const };
  await service.recordFileAccess({
    ...actor,
    fileId: kept.id,
    action: "uploaded",
  });
  clock = new Date("2026-02-01T11:00:00Z");
  await service.recordFileAccess({
    ...actor,
    fileId: kept.id,
    action: "renamed",
  });
  await service.recordFolderAccess({
    ...actor,
    folderId: folder.id,
    action: "created",
  });
  clock = new Date("2026-02-01T12:00:00Z");
  await service.recordFileAccess({
    ...actor,
    fileId: trashed.id,
    action: "trashed",
  });
  await db.file.update({
    where: { id: trashed.id },
    data: { deletedAt: clock },
  });

  const recent = (await getRetrievalPage(actor.actorUserId, "recent")).items;
  expect(
    recent.map((item) => [item.name, item.lastAction, item.deletedAt !== null]),
  ).toEqual([
    ["trashed.jpg", "trashed", true],
    ["Photos", "created", false],
    ["kept.jpg", "renamed", false],
    ["old.jpg", null, false],
  ]);
  expect(owner.preferences?.showPinsInSidebar).toBe(false);
});
