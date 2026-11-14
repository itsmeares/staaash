import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { assertStorageFilesystemSupported } from "@staaash/db/storage-mutation-executor";
import { prepareStorageMutation } from "@staaash/db/storage-mutations";
import { beforeAll, expect, it, vi } from "vite-plus/test";

import { getStoragePath, getStorageRoot } from "../storage";
import { createFilesService } from "./service";

// `gate.size` folder creations wait for each other after their name checks,
// so each request has checked before any of them creates its folder.
const gate = vi.hoisted(() => ({
  size: 0,
  waiting: [] as Array<() => void>,
  ignoresCase: null as boolean | null,
}));
vi.mock("@/server/durable-storage-mutation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/durable-storage-mutation")>();
  const runDurableStorageMutation: typeof original.runDurableStorageMutation =
    async (input) => {
      if (input.kind === "folder_create" && gate.size > 0) {
        await new Promise<void>((resolve) => {
          gate.waiting.push(resolve);
          if (gate.waiting.length === gate.size) {
            gate.size = 0;
            for (const release of gate.waiting.splice(0)) release();
          }
        });
      }
      return original.runDurableStorageMutation(input);
    };
  return { ...original, runDurableStorageMutation };
});
// Lets a test act as if the disk ignored case, whatever disk it runs on.
vi.mock("@staaash/db/storage-mutation-executor", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@staaash/db/storage-mutation-executor")
    >();
  return {
    ...original,
    assertStorageFilesystemSupported: async (root: string) => {
      const traits = await original.assertStorageFilesystemSupported(root);
      return gate.ignoresCase === null
        ? traits
        : { ...traits, ignoresCase: gate.ignoresCase };
    },
  };
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
      email: `${id}@case-names.test`,
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

const createAtOnce = async (
  { id, rootId }: Awaited<ReturnType<typeof drive>>,
  names: string[],
) => {
  gate.size = names.length;
  const results = await Promise.allSettled(
    names.map((name) =>
      service.createFolder({
        actorUserId: id,
        actorRole: "member",
        parentId: rootId,
        name,
      }),
    ),
  );
  const rows = await db.folder.findMany({
    where: { ownerUserId: id, isFilesRoot: false },
    select: { name: true },
  });
  const stuck = await db.storageMutation.count({
    where: { ownerUserId: id, status: "recovery_required" },
  });
  return {
    created: results.filter((result) => result.status === "fulfilled").length,
    rows: rows.map((row) => row.name),
    directories: await readdir(getStoragePath(`files/${id}`)),
    stuck,
  };
};

it(
  "gives every folder made at the same moment a directory of its own",
  { timeout: 60_000 },
  async () => {
    gate.ignoresCase = null;
    const { ignoresCase } =
      await assertStorageFilesystemSupported(getStorageRoot());
    const owner = await drive();

    const latin = await createAtOnce(owner, ["Foo", "foo"]);
    // Windows folds dotless ı and i to the same capital I.
    const dotless = await createAtOnce(await drive(), ["Dıary", "Diary"]);

    for (const outcome of [latin, dotless]) {
      expect(outcome.stuck).toBe(0);
      expect(outcome.rows).toHaveLength(outcome.directories.length);
    }
    if (ignoresCase) {
      expect(latin.created).toBe(1);
      return;
    }
    // Here the two are different folders: one may be told to try again.
    for (const name of ["Foo", "foo"].filter((n) => !latin.rows.includes(n))) {
      await service.createFolder({
        actorUserId: owner.id,
        actorRole: "member",
        parentId: owner.rootId,
        name,
      });
    }
    await expect(readdir(getStoragePath(`files/${owner.id}`))).resolves.toEqual(
      expect.arrayContaining(["Foo", "foo"]),
    );
  },
);

it(
  "makes one folder when Foo and foo arrive at once on a disk that ignores case",
  { timeout: 60_000 },
  async () => {
    gate.ignoresCase = true;
    try {
      const outcome = await createAtOnce(await drive(), ["Foo", "foo"]);

      expect(outcome).toMatchObject({ created: 1, stuck: 0 });
      expect(outcome.rows).toHaveLength(1);
    } finally {
      gate.ignoresCase = null;
    }
  },
);

it("locks a path and a spelling of it that differs only in case as one path", async () => {
  const { id } = await drive();
  const prepareMkdir = (name: string) =>
    prepareStorageMutation({
      kind: "folder_create",
      ownerUserId: id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: { version: 1, metadataOperations: [] },
      steps: [
        {
          action: "mkdir",
          targetKey: `files/${id}/${name}`,
          expectedNodeType: "directory",
        },
      ],
    });

  const { mutation } = await prepareMkdir("Report");

  await expect(prepareMkdir("REPORT")).rejects.toMatchObject({
    code: "STORAGE_MUTATION_IN_PROGRESS",
  });
  // A lock taken by an older version keeps the spelling it was given.
  await db.storageMutationResource.updateMany({
    where: { mutationId: mutation.id },
    data: { resourceKey: `owner:${id}/files/${id}/Report` },
  });
  await expect(prepareMkdir("report/Inside")).rejects.toMatchObject({
    code: "STORAGE_MUTATION_IN_PROGRESS",
  });
});

it("refuses a new name that matches an existing one in another case when the disk ignores case", async () => {
  const { id, rootId } = await drive();
  await db.folder.create({
    data: { ownerUserId: id, parentId: rootId, name: "Foo" },
  });
  const prepareCreate = (namesIgnoreCase: boolean) => {
    const folderId = randomUUID();
    return prepareStorageMutation({
      kind: "folder_create",
      ownerUserId: id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      namesIgnoreCase,
      intentJson: {
        version: 1,
        metadataOperations: [
          {
            action: "create_folder",
            data: {
              id: folderId,
              ownerUserId: id,
              parentId: rootId,
              name: "foo",
            },
          },
        ],
      },
      steps: [],
      resourceKeys: [`owner:${id}/files/${id}/${folderId}`],
    });
  };

  await expect(prepareCreate(true)).rejects.toMatchObject({
    code: "STORAGE_MUTATION_IN_PROGRESS",
  });
  await expect(prepareCreate(false)).resolves.toMatchObject({
    replayed: false,
  });
});
