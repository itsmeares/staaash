import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { createPrismaFilesRepository } from "./repository";

it("scopes ancestry and archives to the owner, stops cycles, and excludes deleted branches", async () => {
  const db = getPrisma();
  const repo = createPrismaFilesRepository();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@share.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const other = await db.user.create({
    data: {
      email: `${randomUUID()}@share.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const folder = (
    name: string,
    parentId: string | null = null,
    overrides = {},
  ) =>
    db.folder.create({
      data: { ownerUserId: owner.id, name, parentId, ...overrides },
    });
  const root = await folder("Files", null, { isFilesRoot: true });
  const shared = await folder("Shared", root.id);
  const child = await folder("Child", shared.id);
  const empty = await folder("Empty", child.id);
  const deleted = await folder("Deleted", shared.id, { deletedAt: new Date() });
  const hidden = await folder("Hidden", deleted.id);
  const unrelated = await folder("Private", root.id);
  const foreign = await folder("Foreign", shared.id, { ownerUserId: other.id });
  expect(
    new Set(
      (await repo.listFolderAncestors(owner.id, [empty.id])).map(
        ({ id }) => id,
      ),
    ),
  ).toEqual(new Set([root.id, shared.id, child.id, empty.id]));
  expect(await repo.listFolderAncestors(other.id, [child.id])).toEqual([]);
  expect(
    (await repo.listFolderAncestors(owner.id, [hidden.id])).some(
      ({ deletedAt }) => deletedAt,
    ),
  ).toBe(true);
  const subtree = await repo.listFolderSubtree(owner.id, shared.id);
  expect(new Set(subtree.map(({ id }) => id))).toEqual(
    new Set([shared.id, child.id, empty.id]),
  );
  expect(
    subtree.some(({ id }) =>
      [deleted.id, hidden.id, unrelated.id, foreign.id].includes(id),
    ),
  ).toBe(false);
  const file = (name: string, folderId: string, overrides = {}) =>
    db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId,
        originalName: name,
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
        ...overrides,
      },
    });
  const a = await file("a.txt", child.id);
  const b = await file("b.txt", child.id, { storageStatus: "missing" });
  await file("deleted.txt", child.id, { deletedAt: new Date() });
  await file("private.txt", unrelated.id);
  await file("foreign.txt", child.id, { ownerUserId: other.id });
  await file("hidden.txt", hidden.id);
  expect(
    (
      await repo.listFilesInFolders(
        owner.id,
        subtree.map(({ id }) => id),
      )
    ).map(({ id }) => id),
  ).toEqual([a.id, b.id]);
  expect(
    (
      await repo.listChildFiles(owner.id, child.id, { includeMissing: true })
    ).map(({ id }) => id),
  ).toEqual([a.id, b.id]);
  await db.folder.update({
    where: { id: shared.id },
    data: { parentId: child.id },
  });
  expect(
    new Set(
      (await repo.listFolderAncestors(owner.id, [child.id])).map(
        ({ id }) => id,
      ),
    ),
  ).toEqual(new Set([shared.id, child.id]));
  expect(
    new Set(
      (await repo.listFolderSubtree(owner.id, shared.id)).map(({ id }) => id),
    ),
  ).toEqual(new Set([shared.id, child.id, empty.id]));
});
