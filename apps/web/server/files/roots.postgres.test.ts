import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { createPrismaFilesRepository } from "./repository";

it("creates one root, reuses it, and keeps another account separate", async () => {
  const db = getPrisma();
  const users = await Promise.all(
    [0, 1].map(() =>
      db.user.create({
        data: {
          email: `${randomUUID()}@root.test`,
          storageId: randomUUID(),
          passwordHash: "test-only",
        },
      }),
    ),
  );
  const repo = createPrismaFilesRepository();
  const root = await repo.ensureFilesRoot(users[0].id);
  expect(root).toMatchObject({
    name: "Files",
    isFilesRoot: true,
    ownerUserId: users[0].id,
  });
  expect((await repo.ensureFilesRoot(users[0].id)).id).toBe(root.id);
  expect((await repo.ensureFilesRoot(users[1].id)).id).not.toBe(root.id);
  expect(
    await db.folder.count({
      where: { ownerUserId: users[0].id, isFilesRoot: true },
    }),
  ).toBe(1);
});

it("keeps every legacy branch when duplicate roots are consolidated", async () => {
  const db = getPrisma();
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@root.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const canonical = await db.folder.create({
    data: {
      ownerUserId: user.id,
      name: "Files",
      isFilesRoot: true,
      createdAt: new Date("2026-01-01"),
    },
  });
  const duplicate = await db.folder.create({
    data: {
      ownerUserId: user.id,
      name: "Old",
      isFilesRoot: true,
      createdAt: new Date("2026-02-01"),
    },
  });
  const child = await db.folder.create({
    data: { ownerUserId: user.id, name: "Child", parentId: duplicate.id },
  });
  expect(
    (await createPrismaFilesRepository().ensureFilesRoot(user.id)).id,
  ).toBe(canonical.id);
  expect(
    await db.folder.findUniqueOrThrow({ where: { id: duplicate.id } }),
  ).toMatchObject({ isFilesRoot: false, parentId: canonical.id });
  expect(
    await db.folder.findUniqueOrThrow({ where: { id: child.id } }),
  ).toMatchObject({ parentId: duplicate.id });
});
