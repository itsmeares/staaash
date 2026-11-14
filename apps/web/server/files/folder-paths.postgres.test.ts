import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { assertStorageFilesystemSupported } from "@staaash/db/storage-mutation-executor";
import { beforeAll, expect, it, vi } from "vite-plus/test";

import { getStoragePath, getStorageRoot } from "../storage";
import { prismaFilesRepository } from "./repository";
import { createFilesService } from "./service";

// Runs once, after a request planned its folders and before it creates them.
const beforeFolderCreate = vi.hoisted(() => ({
  run: null as null | (() => Promise<unknown>),
}));
vi.mock("@/server/durable-storage-mutation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/durable-storage-mutation")>();
  const runDurableStorageMutation: typeof original.runDurableStorageMutation =
    async (input) => {
      const { run } = beforeFolderCreate;
      if (input.kind === "folder_create" && run) {
        beforeFolderCreate.run = null;
        await run();
      }
      return original.runDurableStorageMutation(input);
    };
  return { ...original, runDurableStorageMutation };
});

const db = getPrisma();
const service = createFilesService();

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

const drive = async () => {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `${id}@folder-paths.test`,
      storageId: id,
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  return { id, rootId: root.id };
};

const ensure = (
  { id, rootId }: { id: string; rootId: string },
  paths: string[],
  idempotencyKey?: string,
) =>
  service.ensureFolderPaths({
    actorUserId: id,
    actorRole: "member",
    parentId: rootId,
    paths,
    idempotencyKey,
  });

const createMutations = (ownerUserId: string) =>
  db.storageMutation.findMany({
    where: { ownerUserId, kind: "folder_create" },
    select: { status: true, _count: { select: { steps: true } } },
  });

const isDirectory = async (storageKey: string) =>
  (await stat(getStoragePath(storageKey))).isDirectory();

it(
  "creates the folders of one request in a few journal entries, parents first",
  {
    timeout: 30_000,
  },
  async () => {
    const owner = await drive();
    // 250 leaves under 5 parents under one top folder: 256 folders.
    const paths = Array.from(
      { length: 250 },
      (_, index) => `Album/Part ${index % 5}/Day ${index}`,
    );

    const result = await ensure(owner, paths);

    expect(result.folders.map((folder) => folder.path)).toEqual(paths);
    const folders = await db.folder.findMany({
      where: { ownerUserId: owner.id, isFilesRoot: false },
      select: { id: true, name: true, parentId: true },
    });
    expect(folders).toHaveLength(256);
    const album = folders.find((folder) => folder.name === "Album")!;
    expect(album.parentId).toBe(owner.rootId);
    const part = folders.find((folder) => folder.name === "Part 3")!;
    expect(part.parentId).toBe(album.id);
    const day = folders.find((folder) => folder.name === "Day 3")!;
    expect(day.parentId).toBe(part.id);
    expect(result.folders[3]!.folderId).toBe(day.id);
    await expect(
      isDirectory(`files/${owner.id}/Album/Part 3/Day 3`),
    ).resolves.toBe(true);

    const mutations = await createMutations(owner.id);
    expect(mutations).toHaveLength(3);
    expect(mutations.every((mutation) => mutation.status === "succeeded")).toBe(
      true,
    );
    expect(
      mutations.reduce((total, mutation) => total + mutation._count.steps, 0),
    ).toBe(256);
  },
);

it("creates only what is missing and returns the same folders when asked again", async () => {
  const owner = await drive();
  const key = randomUUID();
  const first = await ensure(owner, ["Trip/Photos", "Trip/Notes"], key);

  const again = await ensure(owner, ["Trip/Photos", "Trip/Notes"], key);
  const more = await ensure(owner, ["Trip/Photos/Raw", "Trip/Notes"]);

  expect(again).toEqual(first);
  expect(more.folders[1]).toEqual(first.folders[1]);
  await expect(
    db.folder.count({ where: { ownerUserId: owner.id, isFilesRoot: false } }),
  ).resolves.toBe(4);
  await expect(createMutations(owner.id)).resolves.toHaveLength(2);
  await expect(isDirectory(`files/${owner.id}/Trip/Photos/Raw`)).resolves.toBe(
    true,
  );
});

it("refuses a path that runs through a file and creates nothing", async () => {
  const owner = await drive();
  await service.uploadFiles({
    actorUserId: owner.id,
    actorRole: "member",
    folderId: owner.rootId,
    idempotencyKey: randomUUID(),
    items: [
      {
        clientKey: randomUUID(),
        originalName: "Report",
        conflictStrategy: "fail",
        file: new File(["report"], "Report", { type: "text/plain" }),
      },
    ],
  });

  await expect(
    ensure(owner, ["Fresh/One", "Report/Inside"]),
  ).rejects.toMatchObject({ code: "FOLDER_NAME_CONFLICT" });
  await expect(
    db.folder.count({ where: { ownerUserId: owner.id, isFilesRoot: false } }),
  ).resolves.toBe(0);
});

it("treats names that differ only in case as the disk does", async () => {
  const owner = await drive();
  const { ignoresCase } =
    await assertStorageFilesystemSupported(getStorageRoot());
  await ensure(owner, ["Trip"]);

  const existing = ensure(owner, ["trip/Day"]);
  const planned = ensure(owner, ["New/Day", "New/day"]);

  if (ignoresCase) {
    await expect(existing).rejects.toMatchObject({
      code: "FOLDER_NAME_CONFLICT",
    });
    await expect(planned).rejects.toMatchObject({
      code: "FOLDER_NAME_CONFLICT",
    });
  } else {
    await expect(existing).resolves.toBeDefined();
    await expect(planned).resolves.toBeDefined();
  }
  await expect(
    db.folder.count({ where: { ownerUserId: owner.id, isFilesRoot: false } }),
  ).resolves.toBe(ignoresCase ? 1 : 6);
});

it(
  "keeps one set of folders when the same request arrives twice at once",
  { timeout: 30_000 },
  async () => {
    const owner = await drive();
    const key = randomUUID();
    const paths = Array.from({ length: 30 }, (_, index) => `Set/Item ${index}`);

    const outcomes = await Promise.allSettled([
      ensure(owner, paths, key),
      ensure(owner, paths, key),
    ]);

    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(
      true,
    );
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        // The loser is told to try again; it never leaves the journal unsure.
        expect(outcome.reason).toMatchObject({
          code: "STORAGE_ADMISSION_BUSY",
        });
      }
    }
    const again = await ensure(owner, paths, key);
    expect(again.folders).toHaveLength(30);
    await expect(
      db.folder.count({ where: { ownerUserId: owner.id, isFilesRoot: false } }),
    ).resolves.toBe(31);
    await expect(
      db.storageMutation.count({
        where: { ownerUserId: owner.id, status: "recovery_required" },
      }),
    ).resolves.toBe(0);
  },
);

it("creates the path again when its folder was renamed since the first request", async () => {
  const owner = await drive();
  const key = randomUUID();
  const first = await ensure(owner, ["Trip/Photos"], key);
  await service.renameFolder({
    actorUserId: owner.id,
    actorRole: "member",
    folderId: first.folders[0]!.folderId,
    name: "Pictures",
  });

  const again = await ensure(owner, ["Trip/Photos"], key);

  expect(again.folders[0]!.folderId).not.toBe(first.folders[0]!.folderId);
  await expect(isDirectory(`files/${owner.id}/Trip/Photos`)).resolves.toBe(
    true,
  );
  await expect(isDirectory(`files/${owner.id}/Trip/Pictures`)).resolves.toBe(
    true,
  );
  await expect(
    db.storageMutation.count({
      where: { ownerUserId: owner.id, status: "recovery_required" },
    }),
  ).resolves.toBe(0);
});

it(
  "creates nothing at the old path when a parent is renamed while the request runs",
  {
    timeout: 30_000,
  },
  async () => {
    const owner = await drive();
    const { folders } = await ensure(owner, ["Outer", "Outer/Inner"]);
    beforeFolderCreate.run = () =>
      service.renameFolder({
        actorUserId: owner.id,
        actorRole: "member",
        folderId: folders[0]!.folderId,
        name: "Moved",
      });

    await expect(
      service.ensureFolderPaths({
        actorUserId: owner.id,
        actorRole: "member",
        parentId: folders[1]!.folderId,
        paths: ["A", "B"],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ADMISSION_BUSY" });

    await expect(
      stat(getStoragePath(`files/${owner.id}/Outer`)),
    ).rejects.toThrow();
    await expect(isDirectory(`files/${owner.id}/Moved/Inner`)).resolves.toBe(
      true,
    );
    await expect(
      db.folder.count({ where: { ownerUserId: owner.id, isFilesRoot: false } }),
    ).resolves.toBe(2);
    const again = await ensure({ id: owner.id, rootId: folders[1]!.folderId }, [
      "A",
      "B",
    ]);
    expect(again.folders).toHaveLength(2);
    await expect(isDirectory(`files/${owner.id}/Moved/Inner/A`)).resolves.toBe(
      true,
    );
  },
);

it(
  "creates nothing at the old path when a folder two levels up is renamed while the request plans",
  {
    timeout: 30_000,
  },
  async () => {
    const owner = await drive();
    const { folders } = await ensure(owner, ["Outer", "Outer/Inner"]);
    const [outer] = folders;
    const listChildFolders = prismaFilesRepository.listChildFolders.bind(
      prismaFilesRepository,
    );
    // Outer is already read with its old name when the planner lists its
    // children, so Inner comes back with the revision the rename gave it.
    const spy = vi
      .spyOn(prismaFilesRepository, "listChildFolders")
      .mockImplementation(async (ownerUserId, parentId, options) => {
        if (parentId === outer!.folderId) {
          spy.mockRestore();
          await service.renameFolder({
            actorUserId: owner.id,
            actorRole: "member",
            folderId: outer!.folderId,
            name: "Moved",
          });
        }
        return listChildFolders(ownerUserId, parentId, options);
      });

    await expect(ensure(owner, ["Outer/Inner/New"])).rejects.toMatchObject({
      code: "STORAGE_ADMISSION_BUSY",
    });

    await expect(
      stat(getStoragePath(`files/${owner.id}/Outer`)),
    ).rejects.toThrow();
    await ensure(owner, ["Moved/Inner/New"]);
    await expect(
      isDirectory(`files/${owner.id}/Moved/Inner/New`),
    ).resolves.toBe(true);
  },
);
