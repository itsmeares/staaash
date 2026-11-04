import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { beforeAll, expect, it } from "vite-plus/test";

import { authService } from "../auth/service";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { app } from "../http/app";
import { getStoragePath } from "../storage";
import { createFilesService } from "./service";

const db = getPrisma();
const service = createFilesService();
const OLD = new Date("2020-01-01T00:00:00Z");

beforeAll(async () => {
  await db.instance.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      name: "Test drive",
      authSecret: "test-only",
      storageProtocolVersion: 2,
    },
    update: { storageProtocolVersion: 2 },
  });
});

// Files / A / B, and Files / C beside A.
const drive = async () => {
  const id = randomUUID();
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@folder-dates.test`,
      storageId: id,
      passwordHash: "test-only",
      preferences: { create: { onboardingCompletedAt: new Date() } },
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  const actor = { actorUserId: id, actorRole: "member" as const };
  const make = async (parentId: string, name: string) =>
    (await service.createFolder({ ...actor, parentId, name })).folder;
  const a = await make(root.id, "A");
  const b = await make(a.id, "B");
  const c = await make(root.id, "C");
  const upload = async (folderId: string, name: string, text: string) =>
    (
      await service.uploadFiles({
        ...actor,
        folderId,
        idempotencyKey: randomUUID(),
        items: [
          {
            clientKey: randomUUID(),
            originalName: name,
            conflictStrategy: "replace",
            file: new File([text], name, { type: "text/plain" }),
          },
        ],
      })
    ).uploadedFiles[0]!;
  const ids = { root: root.id, a: a.id, b: b.id, c: c.id };
  // Moves every date back, then reports which folders moved forward.
  const age = () =>
    db.$executeRaw`UPDATE "Folder" SET "updatedAt" = ${OLD} WHERE "ownerUserId" = ${id}`;
  const fresh = async () => {
    const rows = await db.folder.findMany({
      where: { id: { in: Object.values(ids) } },
      select: { id: true, updatedAt: true },
    });
    return Object.entries(ids)
      .filter(([, folderId]) =>
        rows.some((row) => row.id === folderId && row.updatedAt > OLD),
      )
      .map(([name]) => name)
      .sort();
  };
  return { user, actor, ids, upload, age, fresh, make };
};

it("moves every folder above an uploaded or replaced file, and only those", async () => {
  const { ids, upload, age, fresh } = await drive();
  await age();
  await upload(ids.b, "notes.txt", "first");
  expect(await fresh()).toEqual(["a", "b", "root"]);

  await age();
  await upload(ids.b, "notes.txt", "second");
  expect(await fresh()).toEqual(["a", "b", "root"]);
});

it("moves folder dates for a desktop resumable upload", async () => {
  const { user, ids, age, fresh } = await drive();
  const { sessionToken } = await authService.createSession(user.id, {});
  const call = (path: string, method: string, body: BodyInit, extra = {}) =>
    app.request(`http://localhost:3000${path}`, {
      method,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...extra,
      },
      body,
    });
  const bytes = Buffer.from("from the desktop");
  await age();
  const created = await call(
    "/api/uploads/sessions",
    "POST",
    JSON.stringify({
      folderId: ids.b,
      originalName: "synced.txt",
      mimeType: "text/plain",
      totalSizeBytes: bytes.length,
    }),
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const chunk = await call(`/api/uploads/sessions/${id}`, "PATCH", bytes, {
    "content-type": "application/octet-stream",
    "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
  });
  expect(chunk.status, await chunk.clone().text()).toBe(200);
  const complete = await call(
    `/api/uploads/sessions/${id}/complete`,
    "POST",
    JSON.stringify({
      expectedChecksum: createHash("sha256").update(bytes).digest("hex"),
    }),
  );
  expect(complete.status, await complete.clone().text()).toBe(201);
  expect(await fresh()).toEqual(["a", "b", "root"]);
});

it("moves folder dates when a file is renamed, moved, trashed, or restored", async () => {
  const { actor, ids, upload, age, fresh } = await drive();
  const file = await upload(ids.b, "draft.txt", "text");

  await age();
  await service.renameFile({ ...actor, fileId: file.id, name: "final.txt" });
  expect(await fresh()).toEqual(["a", "b", "root"]);

  await age();
  await service.moveFile({
    ...actor,
    fileId: file.id,
    destinationFolderId: ids.c,
  });
  expect(await fresh()).toEqual(["a", "b", "c", "root"]);

  await age();
  await service.trashFile({ ...actor, fileId: file.id });
  expect(await fresh()).toEqual(["c", "root"]);

  await age();
  await service.restoreFile({ ...actor, fileId: file.id });
  expect(await fresh()).toEqual(["c", "root"]);
});

it("moves a renamed or moved folder's own date, but not for a new color", async () => {
  const { actor, ids, age, fresh, make } = await drive();
  await age();
  await make(ids.b, "New");
  expect(await fresh()).toEqual(["a", "b", "root"]);

  await age();
  await service.renameFolder({ ...actor, folderId: ids.b, name: "Renamed" });
  expect(await fresh()).toEqual(["a", "b", "root"]);

  await age();
  await service.moveFolder({
    ...actor,
    folderId: ids.b,
    destinationFolderId: ids.c,
  });
  expect(await fresh()).toEqual(["a", "b", "c", "root"]);

  await age();
  await service.setFolderAppearance({
    ...actor,
    folderId: ids.b,
    color: "#112233",
    icon: "Star",
  });
  expect(await fresh()).toEqual([]);

  await service.setFolderAppearance({
    ...actor,
    folderId: ids.b,
    color: "#112233",
  });
  expect(await fresh()).toEqual([]);
});

it("does not move dates on trashed folders", async () => {
  const { actor, ids, upload, age, fresh } = await drive();
  const file = await upload(ids.b, "inside.txt", "text");
  await service.trashFolder({ ...actor, folderId: ids.a });
  await age();
  await db.file.update({
    where: { id: file.id },
    data: { originalName: "renamed-in-trash.txt" },
  });
  expect(await fresh()).toEqual([]);
});

it("writes UTC dates when the database session uses another time zone", async () => {
  const { user, ids, age } = await drive();
  await age();
  const before = Date.now();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Honolulu'`;
    await tx.file.create({
      data: {
        ownerUserId: user.id,
        folderId: ids.b,
        originalName: "hawaii.txt",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1n,
      },
    });
  });
  const { updatedAt } = await db.folder.findUniqueOrThrow({
    where: { id: ids.b },
  });
  expect(Math.abs(updatedAt.getTime() - before)).toBeLessThan(60_000);
});
