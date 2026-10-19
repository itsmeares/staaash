import { randomUUID } from "node:crypto";
import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  prepareStorageMutation,
  type StorageMetadataOperation,
} from "@staaash/db/storage-mutations";
import { expect, it } from "vite-plus/test";

const db = getPrisma();
const createOwner = async () => {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      email: `${id}@namespace.test`,
      storageId: id,
      passwordHash: "test-only",
    },
  });
};
const prepare = (
  ownerUserId: string,
  metadataOperations: StorageMetadataOperation[],
) =>
  prepareStorageMutation({
    kind: "folder_restore",
    ownerUserId,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: { version: 1, metadataOperations },
    steps: [],
  });
const createFile = (
  ownerUserId: string,
  folderId: string | null,
  name: string,
): StorageMetadataOperation => ({
  action: "create_file",
  data: {
    id: randomUUID(),
    ownerUserId,
    folderId,
    originalName: name,
    storageKey: randomUUID(),
    mimeType: "text/plain",
    sizeBytes: "1",
    contentChecksum: null,
  },
});

it("checks names without reading files in unrelated folders", async () => {
  const owner = await createOwner();
  const unrelated = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Unrelated" },
  });
  const target = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Target" },
  });
  await db.file.createMany({
    data: Array.from({ length: 2000 }, (_, n) => ({
      ownerUserId: owner.id,
      folderId: unrelated.id,
      originalName: `${n}.txt`,
      storageKey: randomUUID(),
      mimeType: "text/plain",
      sizeBytes: 1,
    })),
  });
  try {
    await prepareStorageMutation(
      {
        kind: "folder_restore",
        ownerUserId: owner.id,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        intentJson: {
          version: 1,
          metadataOperations: Array.from({ length: 130 }, (_, n) =>
            createFile(owner.id, target.id, `${n}.txt`),
          ),
        },
        steps: [],
      },
      {
        client: {
          $transaction: <T>(
            callback: (tx: Prisma.TransactionClient) => Promise<T>,
          ) =>
            db.$transaction(async (tx) => {
              const result = await callback(tx);
              const [stat] = await tx.$queryRaw<
                { reads: bigint }[]
              >`SELECT seq_tup_read + idx_tup_fetch AS reads FROM pg_stat_xact_user_tables WHERE relid='"File"'::regclass`;
              expect(Number(stat.reads)).toBe(0);
              return result;
            }),
        },
      },
    );
  } finally {
    await db.file.deleteMany({ where: { ownerUserId: owner.id } });
  }
}, 15000);

it.each([null, "folder"])(
  "rejects the last conflicting target in a batch with parent %s",
  async (parent) => {
    const owner = await createOwner();
    const folder = await db.folder.create({
      data: { ownerUserId: owner.id, name: "Destination" },
    });
    const parentId = parent ? folder.id : null;
    const existing = await db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId: parentId,
        originalName: "Taken",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
        storageStatus: "missing",
      },
    });
    const targets = Array.from({ length: 130 }, (_, n) =>
      createFile(owner.id, parentId, `Free ${n}`),
    );
    targets.push(createFile(owner.id, parentId, "Taken"));
    await expect(prepare(owner.id, targets)).rejects.toMatchObject({
      code: "STORAGE_MUTATION_IN_PROGRESS",
    });
    expect(
      await db.storageMutation.count({ where: { ownerUserId: owner.id } }),
    ).toBe(0);
    await db.file.delete({ where: { id: existing.id } });
    await db.folder.create({
      data: { ownerUserId: owner.id, parentId, name: "Taken" },
    });
    await expect(prepare(owner.id, targets)).rejects.toMatchObject({
      code: "STORAGE_MUTATION_IN_PROGRESS",
    });
    expect(
      await db.storageMutation.count({ where: { ownerUserId: owner.id } }),
    ).toBe(0);
  },
);

it("allows unchanged self names and ignores another owner, another parent and trash", async () => {
  const owner = await createOwner();
  const other = await createOwner();
  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Destination" },
  });
  const file = await db.file.create({
    data: {
      ownerUserId: owner.id,
      folderId: folder.id,
      originalName: "Self",
      storageKey: randomUUID(),
      mimeType: "text/plain",
      sizeBytes: 1,
    },
  });
  await db.file.createMany({
    data: [
      {
        ownerUserId: other.id,
        folderId: folder.id,
        originalName: "Free",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
      },
      {
        ownerUserId: owner.id,
        folderId: null,
        originalName: "Free",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
      },
      {
        ownerUserId: owner.id,
        folderId: folder.id,
        originalName: "Free",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
        deletedAt: new Date(),
      },
    ],
  });
  const prepared = await prepare(owner.id, [
    {
      action: "update",
      entityType: "file",
      entityId: file.id,
      preRevision: file.storageRevision,
      data: { originalName: "Self" },
    },
    createFile(owner.id, folder.id, "Free"),
  ]);
  expect(prepared.mutation.status).toBe("prepared");
});

it("rejects duplicate names across planned file and folder targets and mismatched owners", async () => {
  const owner = await createOwner();
  const other = await createOwner();
  await expect(
    prepare(owner.id, [
      createFile(owner.id, null, "Same"),
      {
        action: "create_folder",
        data: {
          id: randomUUID(),
          ownerUserId: owner.id,
          parentId: null,
          name: "Same",
        },
      },
    ]),
  ).rejects.toMatchObject({ code: "STORAGE_MUTATION_IN_PROGRESS" });
  await expect(
    prepare(owner.id, [createFile(other.id, null, "Private")]),
  ).rejects.toMatchObject({ code: "STORAGE_MUTATION_IN_PROGRESS" });
  expect(
    await db.storageMutation.count({ where: { ownerUserId: owner.id } }),
  ).toBe(0);
});
