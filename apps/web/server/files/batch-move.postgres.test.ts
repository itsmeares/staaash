import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  claimStorageMutation,
  prepareStorageMutation,
} from "@staaash/db/storage-mutations";
import { StorageTransactionUnavailableError } from "@staaash/db/storage-transactions";
import { beforeAll, expect, it } from "vite-plus/test";

import { batchMoveClaimResourceKeys } from "../../../worker/src/handlers/storage-mutation-parent-recovery.js";
import { recoverStorageMutations } from "../../../worker/src/handlers/storage-mutation-recovery.js";
import { assertStorageEntityReadable } from "../storage-read-guard";
import { getStoragePath, getStorageRoot } from "../storage";
import { startBatchMove } from "./batch-move-request";
import { toBatchMoveOperationResponse } from "./move-operation";

const db = getPrisma();

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

const storagePaths = () => {
  const root = getStorageRoot();
  return {
    filesRoot: root,
    tmpRoot: path.join(root, "tmp"),
    heartbeatPath: path.join(root, "tmp", "worker-heartbeat.json"),
    pendingDeleteRoot: path.join(root, "tmp", "pending-delete"),
    uploadStagingTtlMs: 1,
  };
};

const createOwner = async () => {
  const id = randomUUID();
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@moves.test`,
      storageId: id,
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  return { user, root };
};

const SUBFOLDERS = 49;
const FILES_PER_SUBFOLDER = 50;

const seedLargeFolder = async (ownerUserId: string, rootId: string) => {
  const bytes = Buffer.from("original bytes stay intact");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const source = await db.folder.create({
    data: { ownerUserId, name: "Source", parentId: rootId },
  });
  const target = await db.folder.create({
    data: { ownerUserId, name: "Target", parentId: rootId },
  });
  await mkdir(getStoragePath(`files/${ownerUserId}/Target`));
  const subfolders = Array.from({ length: SUBFOLDERS }, (_, index) => ({
    id: randomUUID(),
    ownerUserId,
    name: `part-${index}`,
    parentId: source.id,
  }));
  await db.folder.createMany({ data: subfolders });
  const files = subfolders.flatMap((folder) =>
    Array.from({ length: FILES_PER_SUBFOLDER }, (_, index) => ({
      id: randomUUID(),
      ownerUserId,
      folderId: folder.id,
      originalName: `${index}.txt`,
      storageKey: `files/${ownerUserId}/Source/${folder.name}/${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      contentChecksum: checksum,
    })),
  );
  await db.file.createMany({ data: files });
  for (const folder of subfolders) {
    await mkdir(getStoragePath(`files/${ownerUserId}/Source/${folder.name}`), {
      recursive: true,
    });
  }
  for (let index = 0; index < files.length; index += 200) {
    await Promise.all(
      files
        .slice(index, index + 200)
        .map((file) => writeFile(getStoragePath(file.storageKey), bytes)),
    );
  }
  return { source, target, files, bytes };
};

it("moves a folder with 2,500 items after the worker stops right after claiming it", async () => {
  const { user, root } = await createOwner();
  const { source, target, files, bytes } = await seedLargeFolder(
    user.id,
    root.id,
  );

  const { mutationId } = await startBatchMove({
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    request: {
      destinationFolderId: target.id,
      items: [{ id: source.id, kind: "folder" }],
      source: "direct",
    },
  });
  expect(
    await db.storageMutationEntity.count({ where: { mutationId } }),
  ).toBeGreaterThan(2_500);

  // A worker claims the move and stops before doing any work.
  const parent = await db.storageMutation.findUniqueOrThrow({
    where: { id: mutationId },
  });
  const crashed = await claimStorageMutation({
    id: mutationId,
    leaseOwner: "crashed-worker",
    leaseMs: 1,
    resolveResourceKeys: (client) => batchMoveClaimResourceKeys(parent, client),
  });
  expect(crashed?.leaseToken).toBe(1n);
  expect(
    await db.storageMutationResource.findMany({
      where: { mutationId, releasedAt: null },
      select: { resourceKey: true },
      orderBy: { resourceKey: "asc" },
    }),
  ).toEqual([
    { resourceKey: `owner:${user.id}/files/${user.id}/source` },
    { resourceKey: `owner:${user.id}/files/${user.id}/target/source` },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 5));

  await recoverStorageMutations({
    storagePaths: storagePaths(),
    kinds: ["batch_move"],
  });

  expect(
    await db.storageMutation.findUniqueOrThrow({
      where: { id: mutationId },
      select: { status: true, attemptCount: true },
    }),
  ).toEqual({ status: "succeeded", attemptCount: 2 });
  expect(
    await db.storageMutationResource.count({
      where: { mutationId, releasedAt: null },
    }),
  ).toBe(0);
  await expect(
    assertStorageEntityReadable("folder", source.id),
  ).resolves.toBeUndefined();
  expect(
    (await db.folder.findUniqueOrThrow({ where: { id: source.id } })).parentId,
  ).toBe(target.id);
  const moved = await db.file.findMany({
    where: { id: { in: files.map((file) => file.id) } },
    select: { storageKey: true },
  });
  expect(moved).toHaveLength(SUBFOLDERS * FILES_PER_SUBFOLDER);
  for (const file of moved) {
    expect(file.storageKey).toMatch(
      new RegExp(`^files/${user.id}/Target/Source/part-\\d+/\\d+\\.txt$`),
    );
    expect(await readFile(getStoragePath(file.storageKey))).toEqual(bytes);
  }
  await expect(
    access(getStoragePath(`files/${user.id}/Source`)),
  ).rejects.toMatchObject({ code: "ENOENT" });
}, 120_000);

const failClaimsFor = async (mutationId: string) => {
  const suffix = randomUUID().replaceAll("-", "");
  await db.$executeRawUnsafe(`
    CREATE FUNCTION fail_claim_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = '${mutationId}' AND NEW.status = 'running' THEN
        RAISE EXCEPTION 'claim timed out' USING ERRCODE = '57014';
      END IF;
      RETURN NEW;
    END $$`);
  await db.$executeRawUnsafe(
    `CREATE TRIGGER fail_claim_${suffix} BEFORE UPDATE ON "StorageMutation" FOR EACH ROW EXECUTE FUNCTION fail_claim_${suffix}()`,
  );
  return async () => {
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_claim_${suffix} ON "StorageMutation"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_claim_${suffix}`);
  };
};

it("gives up on a move that can never start and frees its items", async () => {
  const { user, root } = await createOwner();
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Stuck", parentId: root.id },
  });
  const target = await db.folder.create({
    data: { ownerUserId: user.id, name: "Elsewhere", parentId: root.id },
  });
  const { mutationId } = await startBatchMove({
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    request: {
      destinationFolderId: target.id,
      items: [{ id: folder.id, kind: "folder" }],
      source: "direct",
    },
  });
  const claim = () =>
    claimStorageMutation({
      id: mutationId,
      leaseOwner: "move-worker",
      resourceKeys: [`owner:${user.id}/files/${user.id}/Stuck`],
    });
  const state = () =>
    db.storageMutation.findUniqueOrThrow({
      where: { id: mutationId },
      select: { status: true, claimFailureCount: true, idempotencyKey: true },
    });

  // Waiting behind another live mutation is not a failure.
  const holder = await prepareStorageMutation({
    kind: "folder_rename",
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: {
      version: 1,
      metadataOperations: [],
    } as unknown as Prisma.InputJsonValue,
    readStorageKeys: [`files/${user.id}/Stuck/inner`],
    steps: [],
  });
  await expect(claim()).rejects.toMatchObject({
    code: "STORAGE_MUTATION_IN_PROGRESS",
  });
  expect((await state()).claimFailureCount).toBe(0);
  await db.storageMutation.delete({ where: { id: holder.mutation.id } });

  const restore = await failClaimsFor(mutationId);
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      await expect(claim()).rejects.toBeInstanceOf(
        StorageTransactionUnavailableError,
      );
    }
    // Ten quick failures on a fresh move are not enough to give up.
    expect(await state()).toMatchObject({
      status: "prepared",
      claimFailureCount: 10,
    });
    await db.storageMutation.update({
      where: { id: mutationId },
      data: { createdAt: new Date(Date.now() - 6 * 60_000) },
    });
    await expect(claim()).rejects.toBeInstanceOf(
      StorageTransactionUnavailableError,
    );
  } finally {
    await restore();
  }

  const aborted = await db.storageMutation.findUniqueOrThrow({
    where: { id: mutationId },
  });
  expect(aborted).toMatchObject({ status: "aborted", idempotencyKey: null });
  expect(aborted.lastError).toContain("claim timed out");
  await expect(
    assertStorageEntityReadable("folder", folder.id),
  ).resolves.toBeUndefined();
  expect(toBatchMoveOperationResponse(aborted)).toMatchObject({
    status: "succeeded",
    response: {
      movedCount: 0,
      failedCount: 1,
      results: [
        {
          id: folder.id,
          kind: "folder",
          status: "failed",
          code: "STORAGE_MUTATION_ABORTED",
          retryable: true,
        },
      ],
    },
  });
});

it("releases the locks of a user action that gives up before it starts", async () => {
  const { user } = await createOwner();
  const prepared = await prepareStorageMutation({
    kind: "file_rename",
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: {
      version: 1,
      metadataOperations: [],
    } as unknown as Prisma.InputJsonValue,
    readStorageKeys: [`files/${user.id}/report.txt`],
    steps: [],
  });
  const mutationId = prepared.mutation.id;
  expect(
    await db.storageMutationResource.count({
      where: { mutationId, releasedAt: null },
    }),
  ).toBe(1);
  await db.storageMutation.update({
    where: { id: mutationId },
    data: {
      createdAt: new Date(Date.now() - 6 * 60_000),
      claimFailureCount: 9,
    },
  });

  const restore = await failClaimsFor(mutationId);
  try {
    await expect(
      claimStorageMutation({ id: mutationId, leaseOwner: "request" }),
    ).rejects.toBeInstanceOf(StorageTransactionUnavailableError);
  } finally {
    await restore();
  }

  expect(
    await db.storageMutation.findUniqueOrThrow({
      where: { id: mutationId },
      select: { status: true },
    }),
  ).toEqual({ status: "aborted" });
  expect(
    await db.storageMutationResource.count({
      where: { mutationId, releasedAt: null },
    }),
  ).toBe(0);
});

it("claims thousands of locks inside one storage transaction", async () => {
  const { user } = await createOwner();
  const resourceKeys = Array.from(
    { length: 5_000 },
    (_, index) => `owner:${user.id}/files/${user.id}/item-${index}`,
  );
  const prepared = await prepareStorageMutation({
    kind: "folder_move",
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: {
      version: 1,
      metadataOperations: [],
    } as unknown as Prisma.InputJsonValue,
    resourceKeys: [],
    steps: [],
  });

  const claimed = await claimStorageMutation({
    id: prepared.mutation.id,
    leaseOwner: "move-worker",
    resourceKeys,
  });

  expect(claimed?.leaseToken).toBe(1n);
  expect(
    await db.storageMutationResource.count({
      where: {
        mutationId: prepared.mutation.id,
        releasedAt: null,
        fenceToken: 1n,
      },
    }),
  ).toBe(5_000);
});

it("refuses a move claim whose paths changed before its locks were taken", async () => {
  const { user, root } = await createOwner();
  const outer = await db.folder.create({
    data: { ownerUserId: user.id, name: "Outer", parentId: root.id },
  });
  const selected = await db.folder.create({
    data: { ownerUserId: user.id, name: "Selected", parentId: outer.id },
  });
  const target = await db.folder.create({
    data: { ownerUserId: user.id, name: "Target", parentId: root.id },
  });
  const { mutationId } = await startBatchMove({
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    request: {
      destinationFolderId: target.id,
      items: [{ id: selected.id, kind: "folder" }],
      source: "direct",
    },
  });
  const parent = await db.storageMutation.findUniqueOrThrow({
    where: { id: mutationId },
  });
  let renamed = false;

  // An unselected parent is renamed after the paths were read.
  await expect(
    claimStorageMutation({
      id: mutationId,
      leaseOwner: "move-worker",
      resolveResourceKeys: async (client) => {
        const keys = await batchMoveClaimResourceKeys(parent, client);
        if (!renamed) {
          renamed = true;
          await db.folder.update({
            where: { id: outer.id },
            data: { name: "Renamed" },
          });
        }
        return keys;
      },
    }),
  ).resolves.toBeNull();
  expect(
    await db.storageMutationResource.count({ where: { mutationId } }),
  ).toBe(0);

  const claimed = await claimStorageMutation({
    id: mutationId,
    leaseOwner: "move-worker",
    resolveResourceKeys: (client) => batchMoveClaimResourceKeys(parent, client),
  });
  expect(claimed?.leaseToken).toBe(1n);
  expect(
    await db.storageMutationResource.findMany({
      where: { mutationId, releasedAt: null },
      select: { resourceKey: true },
      orderBy: { resourceKey: "asc" },
    }),
  ).toEqual([
    { resourceKey: `owner:${user.id}/files/${user.id}/renamed/selected` },
    { resourceKey: `owner:${user.id}/files/${user.id}/target/selected` },
  ]);
});
