import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { beforeAll, expect, it, vi } from "vite-plus/test";

import { SESSION_COOKIE_NAME } from "./auth/session";
import { authService } from "./auth/service";
import { prismaFilesRepository } from "./files/repository";
import { createFilesService } from "./files/service";
import { app } from "./http/app";
import { getStoragePath } from "./storage";

const db = getPrisma();
const service = createFilesService();
const old = new Date("2000-01-01T00:00:00.000Z");

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

async function tree() {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `${id}@folder-modified.test`,
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
  const create = async (parentId: string, name: string) =>
    (await service.createFolder({ ...actor, parentId, name })).folder;
  const a = await create(root.id, "A");
  const b = await create(a.id, "B");
  const child = await create(b.id, "Child");
  const other = await create(root.id, "Other");
  const ids = [root.id, a.id, b.id, child.id, other.id];
  const reset = () =>
    db.folder.updateMany({
      where: { id: { in: ids } },
      data: { updatedAt: old },
    });
  const times = async () =>
    new Map(
      (
        await db.folder.findMany({
          where: { id: { in: ids } },
          select: { id: true, updatedAt: true, storageRevision: true },
        })
      ).map((folder) => [folder.id, folder]),
    );
  return { id, root, actor, a, b, child, other, reset, times };
}

function expectChanged(
  times: Awaited<ReturnType<Awaited<ReturnType<typeof tree>>["times"]>>,
  changed: string[],
  unchanged: string[],
) {
  for (const id of changed)
    expect(times.get(id)!.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  for (const id of unchanged) expect(times.get(id)!.updatedAt).toEqual(old);
}

it("updates ancestors for uploads and same-byte replacements without replaying the date", async () => {
  const { actor, root, a, b, child, other, reset, times } = await tree();
  await reset();
  const input = {
    ...actor,
    folderId: b.id,
    idempotencyKey: randomUUID(),
    items: [
      {
        clientKey: randomUUID(),
        originalName: "empty.txt",
        conflictStrategy: "replace" as const,
        file: new File([], "empty.txt"),
      },
    ],
  };
  const before = await times();
  const first = await service.uploadFiles(input);
  const after = await times();
  expectChanged(after, [root.id, a.id, b.id], [child.id, other.id]);
  for (const id of [root.id, a.id, b.id]) {
    expect(after.get(id)!.storageRevision).toBe(
      before.get(id)!.storageRevision,
    );
  }
  await service.uploadFiles(input);
  expect(await times()).toEqual(after);

  await reset();
  const replaced = await service.uploadFiles({
    ...input,
    idempotencyKey: randomUUID(),
    items: [{ ...input.items[0]!, clientKey: randomUUID() }],
  });
  expect(replaced.uploadedFiles[0]?.id).toBe(first.uploadedFiles[0]?.id);
  expectChanged(await times(), [root.id, a.id, b.id], [child.id, other.id]);

  await reset();
  const conflict = await service.uploadFiles({
    ...input,
    idempotencyKey: randomUUID(),
    items: [
      { ...input.items[0]!, clientKey: randomUUID(), conflictStrategy: "fail" },
    ],
  });
  expect(conflict.conflicts).toHaveLength(1);
  expectChanged(await times(), [], [root.id, a.id, b.id, child.id, other.id]);

  const newer = new Date("2099-01-01T00:00:00Z");
  await db.folder.update({ where: { id: b.id }, data: { updatedAt: newer } });
  await service.uploadFiles({
    ...input,
    idempotencyKey: randomUUID(),
    items: [
      {
        clientKey: randomUUID(),
        originalName: "new.txt",
        conflictStrategy: "fail",
        file: new File(["new"], "new.txt"),
      },
    ],
  });
  expect((await times()).get(b.id)!.updatedAt).toEqual(newer);
});

it("updates old and new ancestor paths without editing descendants", async () => {
  const { id, actor, root, a, b, child, other, reset, times } = await tree();
  const storageKey = `files/${id}/A/B/Child/nested.txt`;
  await writeFile(getStoragePath(storageKey), "nested");
  await db.file.create({
    data: {
      ownerUserId: id,
      folderId: child.id,
      originalName: "nested.txt",
      storageKey,
      mimeType: "text/plain",
      sizeBytes: 6n,
      contentChecksum: null,
    },
  });

  await reset();
  await service.renameFolder({ ...actor, folderId: b.id, name: "Renamed" });
  expectChanged(await times(), [root.id, a.id, b.id], [child.id, other.id]);

  await reset();
  await service.moveFolder({
    ...actor,
    folderId: b.id,
    destinationFolderId: other.id,
  });
  expectChanged(await times(), [root.id, a.id, b.id, other.id], [child.id]);

  await reset();
  await service.trashFolder({ ...actor, folderId: b.id });
  expectChanged(await times(), [root.id, other.id], [a.id, b.id, child.id]);

  await reset();
  await service.restoreFolder({ ...actor, folderId: b.id });
  expectChanged(await times(), [root.id, other.id], [a.id, b.id, child.id]);
});

it("updates the old and new paths for file moves, trash and restore, but not purge", async () => {
  const { actor, root, a, b, child, other, reset, times } = await tree();
  const upload = await service.uploadFiles({
    ...actor,
    folderId: b.id,
    items: [
      {
        clientKey: randomUUID(),
        originalName: "move.txt",
        conflictStrategy: "fail",
        file: new File(["x"], "move.txt"),
      },
    ],
  });
  const fileId = upload.uploadedFiles[0]!.id;
  await reset();
  await service.moveFile({ ...actor, fileId, destinationFolderId: other.id });
  expectChanged(await times(), [root.id, a.id, b.id, other.id], [child.id]);

  await reset();
  await service.trashFile({ ...actor, fileId });
  expectChanged(await times(), [root.id, other.id], [a.id, b.id, child.id]);

  await reset();
  await service.restoreFile({ ...actor, fileId });
  expectChanged(await times(), [root.id, other.id], [a.id, b.id, child.id]);

  await service.trashFile({ ...actor, fileId });
  await reset();
  await service.deleteFile({ ...actor, fileId });
  expectChanged(await times(), [], [root.id, a.id, b.id, child.id, other.id]);
});

it("updates ancestors only when a resumable upload completes", async () => {
  const { id, root, a, b, child, other, reset, times } = await tree();
  const { sessionToken } = await authService.createSession(id, {});
  const request = (
    path: string,
    method: string,
    body?: BodyInit,
    type = "application/json",
    extra = {},
  ) =>
    app.request(`http://localhost:3000${path}`, {
      method,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "content-type": type,
        ...extra,
      },
      body,
    });
  const bytes = Buffer.from("resumable data");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await reset();
  const created = await request(
    "/api/uploads/sessions",
    "POST",
    JSON.stringify({
      folderId: b.id,
      originalName: "resumable.txt",
      mimeType: "text/plain",
      totalSizeBytes: bytes.length,
    }),
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const session = (await created.json()) as { id: string };
  const chunk = await request(
    `/api/uploads/sessions/${session.id}`,
    "PATCH",
    bytes,
    "application/octet-stream",
    {
      "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
    },
  );
  expect(chunk.status, await chunk.clone().text()).toBe(200);
  expectChanged(await times(), [], [root.id, a.id, b.id, child.id, other.id]);
  const complete = () =>
    request(
      `/api/uploads/sessions/${session.id}/complete`,
      "POST",
      JSON.stringify({ expectedChecksum: checksum }),
    );
  const result = await complete();
  expect(result.status, await result.clone().text()).toBe(201);
  const after = await times();
  expectChanged(after, [root.id, a.id, b.id], [child.id, other.id]);
  expect((await complete()).status).toBe(201);
  expect(await times()).toEqual(after);
  const listing = await service.getFilesListing({
    actorUserId: id,
    actorRole: "member",
    folderId: a.id,
  });
  expect(
    listing.childFolders.find((folder) => folder.id === b.id)?.updatedAt,
  ).toEqual(after.get(b.id)!.updatedAt);
});

it("does not replace a newer folder time when appearance changes race an upload", async () => {
  const { actor, root, a, b, reset, times } = await tree();
  await reset();
  const original = prismaFilesRepository.findFolderById.bind(
    prismaFilesRepository,
  );
  let release!: () => void;
  let read!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loaded = new Promise<void>((resolve) => {
    read = resolve;
  });
  let intercepted = false;
  const spy = vi
    .spyOn(prismaFilesRepository, "findFolderById")
    .mockImplementation(async (id) => {
      const folder = await original(id);
      if (id === b.id && !intercepted) {
        intercepted = true;
        read();
        await paused;
      }
      return folder;
    });
  const appearance = service.setFolderAppearance({
    ...actor,
    folderId: b.id,
    color: "blue",
  });
  try {
    await loaded;
    await service.uploadFiles({
      ...actor,
      folderId: b.id,
      items: [
        {
          clientKey: randomUUID(),
          originalName: "race.txt",
          conflictStrategy: "fail",
          file: new File(["x"], "race.txt"),
        },
      ],
    });
    const saved = await times();
    expectChanged(saved, [root.id, a.id, b.id], []);
    release();
    await expect(appearance).resolves.toMatchObject({
      color: "blue",
      updatedAt: saved.get(b.id)!.updatedAt,
    });
    expect(await times()).toEqual(saved);
  } finally {
    release();
    await appearance.catch(() => {});
    spy.mockRestore();
  }
});
