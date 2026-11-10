import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "@staaash/db/client";
import {
  calculateTreeManifestDigest,
  claimAndExecuteStorageMutation,
  executeClaimedStorageMutation,
  StorageMutationAbruptInterruptionError,
} from "@staaash/db/storage-mutation-executor";
import {
  applyStorageMutationIntentMetadata,
  claimStorageMutation,
  discardStalePreparingStorageMutations,
  prepareStorageMutation,
  STORAGE_MUTATION_CHUNK_SIZE,
  StorageMutationConflictError,
  type StorageMetadataOperation,
} from "@staaash/db/storage-mutations";
import { beforeAll, expect, it, vi } from "vite-plus/test";

import { recoverStorageMutations } from "../../../worker/src/handlers/storage-mutation-recovery.js";
import { assertStorageEntityReadable } from "../storage-read-guard";
import { getStoragePath, getStorageRoot } from "../storage";
import { startClearTrash } from "./clear-trash";
import {
  countFolderTreeItems,
  readFolderOperation,
  startFolderOperation,
} from "./folder-operation";
import { createFilesService } from "./service";
import { authService } from "../auth/service";
import { SESSION_COOKIE_NAME } from "../auth/session";
import { app } from "../http/app";

const faults = vi.hoisted(() => ({
  boundary: undefined as undefined | ((boundary: string) => Promise<void>),
}));
vi.mock("@staaash/db/storage-mutation-executor", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@staaash/db/storage-mutation-executor")
    >();
  return {
    ...original,
    claimAndExecuteStorageMutation: (
      input: Parameters<typeof original.claimAndExecuteStorageMutation>[0],
    ) =>
      original.claimAndExecuteStorageMutation({
        ...input,
        executionHook: input.executionHook ?? faults.boundary,
      }),
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
  await db.user.create({
    data: {
      id,
      email: `${id}@large-folder.test`,
      storageId: id,
      passwordHash: "test-only",
      preferences: { create: { onboardingCompletedAt: new Date() } },
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  return { id, root, actor: { actorUserId: id, actorRole: "member" as const } };
};

const SUBFOLDERS = 30;
const FILES_PER_SUBFOLDER = 50;
const bytes = Buffer.from("bytes that must survive");

// 1,531 items: more than one chunk of journal rows.
const seedLargeFolder = async (
  ownerUserId: string,
  rootId: string,
  filesPerSubfolder = FILES_PER_SUBFOLDER,
) => {
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const folder = await db.folder.create({
    data: { ownerUserId, name: "Big", parentId: rootId },
  });
  const subfolders = Array.from({ length: SUBFOLDERS }, (_, index) => ({
    id: randomUUID(),
    ownerUserId,
    name: `part-${index}`,
    parentId: folder.id,
  }));
  await db.folder.createMany({ data: subfolders });
  const files = subfolders.flatMap((subfolder) =>
    Array.from({ length: filesPerSubfolder }, (_, index) => ({
      id: randomUUID(),
      ownerUserId,
      folderId: subfolder.id,
      originalName: `${index}.txt`,
      storageKey: `files/${ownerUserId}/Big/${subfolder.name}/${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      contentChecksum: checksum,
    })),
  );
  await db.file.createMany({ data: files });
  for (const subfolder of subfolders) {
    await mkdir(getStoragePath(`files/${ownerUserId}/Big/${subfolder.name}`), {
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
  return { folder, subfolders, files };
};

const exists = (storageKey: string) =>
  access(getStoragePath(storageKey)).then(
    () => true,
    () => false,
  );

const changesOf = (mutationId: string) =>
  db.storageChange.findMany({
    where: { mutationId },
    select: { kind: true, itemType: true, itemId: true },
  });

const latestMutation = (ownerUserId: string, kind: string) =>
  db.storageMutation.findFirstOrThrow({
    where: { ownerUserId, kind },
    orderBy: { createdAt: "desc" },
  });

it("trashes, restores, renames and deletes a folder of 1,531 items a chunk at a time", async () => {
  const { id, root, actor } = await createOwner();
  const { folder, files } = await seedLargeFolder(id, root.id);
  const sample = files[files.length - 1]!;

  await service.trashFolder({ ...actor, folderId: folder.id });
  const trash = await latestMutation(id, "folder_trash");
  expect(trash).toMatchObject({ status: "succeeded" });
  // Every descendant was committed in chunks before the root folder.
  expect(trash.metadataOperationsApplied).toBe(1 + SUBFOLDERS + files.length);
  expect(await changesOf(trash.id)).toEqual([
    { kind: "trashed", itemType: "folder", itemId: folder.id },
  ]);
  const trashed = await db.file.findUniqueOrThrow({ where: { id: sample.id } });
  expect(trashed.deletedAt).not.toBeNull();
  expect(await exists(sample.storageKey)).toBe(false);
  expect(await readFile(getStoragePath(trashed.storageKey))).toEqual(bytes);
  expect(
    await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM "StorageMutationEntity"
      WHERE "mutationId" = ${trash.id}
        AND ("beforeJson" <> 'null'::jsonb OR "afterJson" <> 'null'::jsonb)`,
  ).toEqual([{ count: 0n }]);

  await service.restoreFolder({ ...actor, folderId: folder.id });
  const restore = await latestMutation(id, "folder_restore");
  expect(restore.status).toBe("succeeded");
  expect(await changesOf(restore.id)).toEqual([
    { kind: "restored", itemType: "folder", itemId: folder.id },
  ]);
  expect(
    await db.file.count({ where: { ownerUserId: id, deletedAt: null } }),
  ).toBe(files.length);
  expect(await readFile(getStoragePath(sample.storageKey))).toEqual(bytes);

  await service.renameFolder({ ...actor, folderId: folder.id, name: "Bigger" });
  const rename = await latestMutation(id, "folder_rename");
  expect(rename.status).toBe("succeeded");
  expect(await changesOf(rename.id)).toEqual([
    { kind: "moved", itemType: "folder", itemId: folder.id },
  ]);
  const renamedKey = sample.storageKey.replace("/Big/", "/Bigger/");
  expect(
    (await db.file.findUniqueOrThrow({ where: { id: sample.id } })).storageKey,
  ).toBe(renamedKey);
  expect(await readFile(getStoragePath(renamedKey))).toEqual(bytes);

  await service.trashFolder({ ...actor, folderId: folder.id });
  const trashRoot = (
    await db.trashEntry.findFirstOrThrow({ where: { rootEntityId: folder.id } })
  ).storageRootKey!;
  await service.clearTrash(actor);
  const purge = await latestMutation(id, "folder_purge");
  expect(purge.status).toBe("succeeded");
  expect(await changesOf(purge.id)).toEqual([
    { kind: "deleted", itemType: "folder", itemId: folder.id },
  ]);
  expect(await db.file.count({ where: { ownerUserId: id } })).toBe(0);
  expect(await db.folder.count({ where: { ownerUserId: id } })).toBe(1);
  expect(await exists(trashRoot)).toBe(false);
}, 120_000);

it("empties a trashed folder of 1,531 items in the worker", async () => {
  const { id, root, actor } = await createOwner();
  const { folder } = await seedLargeFolder(id, root.id);
  await service.trashFolder({ ...actor, folderId: folder.id });

  await startClearTrash(actor, randomUUID());
  await recoverStorageMutations({
    kinds: ["clear_trash"],
    storagePaths: storagePaths(),
  });

  const purge = await latestMutation(id, "folder_purge");
  expect(purge.status).toBe("succeeded");
  expect(purge.metadataOperationsApplied).toBeGreaterThan(
    STORAGE_MUTATION_CHUNK_SIZE,
  );
  expect(await changesOf(purge.id)).toEqual([
    { kind: "deleted", itemType: "folder", itemId: folder.id },
  ]);
  expect(await db.file.count({ where: { ownerUserId: id } })).toBe(0);
}, 120_000);

// A rename journaled by hand, so the test can stop it between chunks.
const prepareLargeRename = async (ownerUserId: string, rootId: string) => {
  const { folder, subfolders, files } = await seedLargeFolder(
    ownerUserId,
    rootId,
  );
  const sourceKey = `files/${ownerUserId}/Big`;
  const targetKey = `files/${ownerUserId}/Renamed`;
  const operations: StorageMetadataOperation[] = [
    ...files.map((file) => ({
      action: "update" as const,
      entityType: "file" as const,
      entityId: file.id,
      preRevision: 0,
      data: { storageKey: file.storageKey.replace(sourceKey, targetKey) },
    })),
    ...subfolders.map((subfolder) => ({
      action: "update" as const,
      entityType: "folder" as const,
      entityId: subfolder.id,
      preRevision: 0,
      data: {},
    })),
    {
      action: "update",
      entityType: "folder",
      entityId: folder.id,
      preRevision: 0,
      data: { name: "Renamed" },
    },
  ];
  const { mutation } = await prepareStorageMutation({
    kind: "folder_rename",
    ownerUserId,
    intentJson: {
      version: 1,
      metadataOperations: operations,
      bulkOperationsEnd: operations.length - 1,
    },
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey,
        expectedNodeType: "directory",
        treeManifestDigest: await calculateTreeManifestDigest(
          getStoragePath(sourceKey),
        ),
      },
    ],
    entities: operations.flatMap((operation) =>
      operation.action === "update"
        ? [
            {
              entityType: operation.entityType,
              entityId: operation.entityId,
              preRevision: 0,
              postRevision: 1,
            },
          ]
        : [],
    ),
  });
  return { mutation, folder, files, targetKey };
};

it("only finishes forward once a chunk has landed, and recovery completes it", async () => {
  const { id, root } = await createOwner();
  const { mutation, folder, files, targetKey } = await prepareLargeRename(
    id,
    root.id,
  );
  const sample = files[0]!;
  const movedKey = sample.storageKey.replace("/Big/", "/Renamed/");

  await expect(
    claimAndExecuteStorageMutation({
      mutationId: mutation.id,
      filesRoot: getStorageRoot(),
      leaseOwner: "crashed",
      commitMetadata: (tx) =>
        applyStorageMutationIntentMetadata(tx, mutation.intentJson),
      executionHook: async (boundary) => {
        if (boundary === "metadata_chunk_applied") {
          throw new StorageMutationAbruptInterruptionError(boundary);
        }
      },
    }),
  ).rejects.toBeInstanceOf(StorageMutationAbruptInterruptionError);
  const stopped = await db.storageMutation.findUniqueOrThrow({
    where: { id: mutation.id },
  });
  expect(stopped).toMatchObject({
    status: "running",
    metadataCommittedAt: null,
    metadataOperationsApplied: STORAGE_MUTATION_CHUNK_SIZE,
  });
  // Half the rows already point at the new path; nobody can read them yet.
  expect(
    (await db.file.findUniqueOrThrow({ where: { id: sample.id } })).storageKey,
  ).toBe(movedKey);
  await expect(
    assertStorageEntityReadable("file", sample.id),
  ).rejects.toThrow();
  await expect(
    assertStorageEntityReadable("folder", folder.id),
  ).rejects.toThrow();

  const { sessionToken } = await authService.createSession(id, {});
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` };
  for (const folderId of [folder.id, root.id]) {
    const response = await app.request(
      `/api/sync/snapshot?folderId=${folderId}&limit=1&cursor=file:a`,
      { headers },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("X-Storage-Mutation-Id")).toBe(mutation.id);
  }
  const unrelated = await db.folder.create({
    data: { ownerUserId: id, parentId: root.id, name: "Quiet" },
  });
  expect(
    (
      await app.request(`/api/sync/snapshot?folderId=${unrelated.id}`, {
        headers,
      })
    ).status,
  ).toBe(200);
  const other = await createOwner();
  const otherSession = await authService.createSession(other.id, {});
  expect(
    (
      await app.request(`/api/sync/snapshot?folderId=${other.root.id}`, {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=${otherSession.sessionToken}`,
        },
      })
    ).status,
  ).toBe(200);

  // Out of attempts, a failed attempt would normally roll back and abort.
  // Here the bytes must stay where the committed rows point.
  await db.storageMutation.update({
    where: { id: mutation.id },
    data: { leaseExpiresAt: new Date(0), attemptCount: 20 },
  });
  const claimed = await claimStorageMutation({
    id: mutation.id,
    leaseOwner: "out-of-attempts",
  });
  await expect(
    executeClaimedStorageMutation({
      mutation: claimed!,
      filesRoot: getStorageRoot(),
      leaseOwner: "out-of-attempts",
      leaseToken: claimed!.leaseToken,
      commitMetadata: (tx) =>
        applyStorageMutationIntentMetadata(tx, mutation.intentJson),
      executionHook: async (boundary) => {
        if (boundary === "forward_steps_applied")
          throw new Error("disk hiccup");
      },
    }),
  ).rejects.toThrow("disk hiccup");
  expect(
    await db.storageMutation.findUniqueOrThrow({ where: { id: mutation.id } }),
  ).toMatchObject({ status: "retrying" });
  expect(await readFile(getStoragePath(movedKey))).toEqual(bytes);

  await db.storageMutation.update({
    where: { id: mutation.id },
    data: { nextAttemptAt: new Date(0) },
  });
  await recoverStorageMutations({ storagePaths: storagePaths() });
  expect(
    await db.storageMutation.findUniqueOrThrow({ where: { id: mutation.id } }),
  ).toMatchObject({ status: "succeeded", metadataOperationsApplied: 1530 });
  expect(
    await db.file.count({
      where: { ownerUserId: id, storageKey: { startsWith: `${targetKey}/` } },
    }),
  ).toBe(files.length);
  expect(
    (await db.folder.findUniqueOrThrow({ where: { id: folder.id } })).name,
  ).toBe("Renamed");
  expect(
    (await app.request(`/api/sync/snapshot?folderId=${folder.id}`, { headers }))
      .status,
  ).toBe(200);
  await expect(assertStorageEntityReadable("file", sample.id)).resolves.toBe(
    undefined,
  );
}, 120_000);

it("leaves nothing behind when a chunked preparation is refused", async () => {
  const { id, root } = await createOwner();
  const { folder, files } = await seedLargeFolder(id, root.id);
  const mutationId = randomUUID();
  const entities = files.map((file, index) => ({
    entityType: "file" as const,
    entityId: file.id,
    // The last chunk names a revision the file no longer has.
    preRevision: index === files.length - 1 ? 7 : 0,
    postRevision: 1,
  }));
  await expect(
    prepareStorageMutation({
      id: mutationId,
      kind: "folder_trash",
      ownerUserId: id,
      intentJson: { version: 1, metadataOperations: [] },
      steps: [],
      resourceKeys: [`owner:${id}/files/${id}/Big`],
      entities,
    }),
  ).rejects.toBeInstanceOf(StorageMutationConflictError);
  expect(await db.storageMutation.count({ where: { id: mutationId } })).toBe(0);
  expect(
    await db.storageMutationResource.count({ where: { mutationId } }),
  ).toBe(0);
  // The folder is free for the next change.
  await service.renameFolder({
    actorUserId: id,
    actorRole: "member",
    folderId: folder.id,
    name: "Free",
  });
}, 120_000);

it("discards a preparation whose request stopped, and frees its locks", async () => {
  const { id } = await createOwner();
  const prepare = (mutationId: string, idempotencyKey: string, name = "Big") =>
    db.storageMutation.create({
      data: {
        id: mutationId,
        kind: "folder_trash",
        status: "preparing",
        ownerUserId: id,
        idempotencyKey,
        requestHash: "hash",
        intentJson: { version: 1, metadataOperations: [] },
        resources: {
          create: {
            resourceKey: `owner:${id}/files/${id}/${name}`,
            fenceToken: 0,
          },
        },
      },
    });
  const stale = await prepare(randomUUID(), randomUUID());
  await db.$executeRaw`
    UPDATE "StorageMutation" SET "updatedAt" = now() - interval '2 minutes'
    WHERE id = ${stale.id}`;

  // A retry of the same request starts over instead of waiting on it.
  const { mutation, replayed } = await prepareStorageMutation({
    kind: "folder_trash",
    ownerUserId: id,
    idempotencyKey: stale.idempotencyKey,
    requestHash: "hash",
    intentJson: { version: 1, metadataOperations: [] },
    steps: [],
    resourceKeys: [`owner:${id}/files/${id}/Big`],
  });
  expect(replayed).toBe(false);
  expect(mutation.id).not.toBe(stale.id);
  expect(mutation.status).toBe("prepared");

  const other = await prepare(randomUUID(), randomUUID(), "Other");
  const fresh = await prepare(randomUUID(), randomUUID(), "Fresh");
  await db.$executeRaw`
    UPDATE "StorageMutation" SET "updatedAt" = now() - interval '2 minutes'
    WHERE id = ${other.id}`;
  expect(await discardStalePreparingStorageMutations()).toBeGreaterThanOrEqual(
    1,
  );
  expect(await db.storageMutation.count({ where: { id: other.id } })).toBe(0);
  expect(
    await db.storageMutationResource.count({ where: { mutationId: other.id } }),
  ).toBe(0);
  expect(await db.storageMutation.count({ where: { id: fresh.id } })).toBe(1);
});

const settled = async (operationId: string, ownerUserId: string) => {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const operation = await readFolderOperation(operationId, ownerUserId);
    if (operation && !["queued", "running"].includes(operation.status)) {
      return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The background change did not settle.");
};

it("runs a large folder change in the background and reports how far it got", async () => {
  const { id, root, actor } = await createOwner();
  const { folder } = await seedLargeFolder(id, root.id);
  const totalCount = await countFolderTreeItems(id, folder.id);
  expect(totalCount).toBe(1 + SUBFOLDERS + SUBFOLDERS * FILES_PER_SUBFOLDER);
  const idempotencyKey = randomUUID();
  const started = await startFolderOperation({
    ownerUserId: id,
    run: (onStorageMutationPrepared) =>
      service.trashFolder({
        ...actor,
        folderId: folder.id,
        idempotencyKey,
        onStorageMutationPrepared,
      }),
  });
  const { operationId } = started;
  expect(started.totalCount).toBe(totalCount);
  expect(["queued", "running", "succeeded"]).toContain(started.status);
  expect(
    await db.storageMutation.findUniqueOrThrow({ where: { id: operationId } }),
  ).not.toMatchObject({ status: "preparing" });
  // A retry of the request follows the change already under way.
  const retried = await startFolderOperation({
    ownerUserId: id,
    run: (onStorageMutationPrepared) =>
      service.trashFolder({
        ...actor,
        folderId: folder.id,
        idempotencyKey,
        onStorageMutationPrepared,
      }),
  });
  expect(retried.operationId).toBe(operationId);

  const done = await settled(operationId, id);
  expect(done).toMatchObject({
    status: "succeeded",
    doneCount: totalCount,
    response: { folder: { id: folder.id } },
  });
  expect(
    await db.storageMutation.findUniqueOrThrow({ where: { id: operationId } }),
  ).toMatchObject({ kind: "folder_trash", status: "succeeded" });
  expect(
    (await db.folder.findUniqueOrThrow({ where: { id: folder.id } })).deletedAt,
  ).not.toBeNull();
  // Another account cannot see it.
  expect(await readFolderOperation(operationId, randomUUID())).toBeNull();
}, 120_000);

it("refuses an invalid change before accepting it in the background", async () => {
  const { id, root, actor } = await createOwner();
  const { folder } = await seedLargeFolder(id, root.id);
  await db.folder.create({
    data: { ownerUserId: id, name: "Taken", parentId: root.id },
  });
  await expect(
    startFolderOperation({
      ownerUserId: id,
      run: (onStorageMutationPrepared) =>
        service.renameFolder({
          ...actor,
          folderId: folder.id,
          name: "Taken",
          onStorageMutationPrepared,
        }),
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.storageMutation.count({ where: { ownerUserId: id } })).toBe(
    0,
  );
  expect(
    (await db.folder.findUniqueOrThrow({ where: { id: folder.id } })).name,
  ).toBe("Big");
}, 120_000);

it("keeps an accepted operation after the web request stops before execution", async () => {
  const { id, root } = await createOwner();
  let finishPlanning!: () => void;
  const planning = new Promise<void>((resolve) => {
    finishPlanning = resolve;
  });
  let accepted = false;
  const started = startFolderOperation({
    ownerUserId: id,
    run: async (onPrepared) => {
      await planning;
      const { mutation } = await prepareLargeRename(id, root.id);
      onPrepared(mutation.id);
      throw new StorageMutationAbruptInterruptionError("forward_steps_applied");
    },
  });
  void started.then(() => {
    accepted = true;
  });
  await db.storageMutation.count({ where: { ownerUserId: id } });
  expect(accepted).toBe(false);
  finishPlanning();
  const operation = await started;
  expect(operation.status).toBe("queued");
  expect(
    await db.storageMutation.findUniqueOrThrow({
      where: { id: operation.operationId },
    }),
  ).toMatchObject({ status: "prepared" });
  vi.resetModules();
  const fresh = await import("./folder-operation");
  expect(
    await fresh.readFolderOperation(operation.operationId, id),
  ).toMatchObject({ status: "queued" });
  await recoverStorageMutations({ storagePaths: storagePaths() });
  expect(
    await fresh.readFolderOperation(operation.operationId, id),
  ).toMatchObject({ status: "succeeded" });
  const file = await db.file.findFirstOrThrow({ where: { ownerUserId: id } });
  expect(await readFile(getStoragePath(file.storageKey))).toEqual(bytes);
}, 120_000);

it("checks the full request when a background rename or move is retried", async () => {
  const { id, root, actor } = await createOwner();
  const { folder, files } = await seedLargeFolder(id, root.id, 70);
  const { sessionToken } = await authService.createSession(id, {});
  const request = (action: string, key: string, body: object) =>
    app.request(`/api/files/folders/${folder.id}/${action}`, {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        "Content-Type": "application/json",
        Prefer: "respond-async",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(body),
    });
  const renameKey = randomUUID();
  const first = await request("rename", renameKey, { name: "First" });
  expect(first.status).toBe(202);
  const rename = await first.json();
  const changedName = await request("rename", renameKey, { name: "Second" });
  expect(changedName.status).toBe(409);
  expect(await changedName.json()).toMatchObject({
    code: "STORAGE_IDEMPOTENCY_KEY_REUSED",
  });
  const retry = await request("rename", renameKey, { name: "First" });
  expect(retry.status).toBe(202);
  expect(await retry.json()).toMatchObject({ operationId: rename.operationId });
  await settled(rename.operationId, id);
  const completedRetry = await request("rename", renameKey, { name: "First" });
  expect(await completedRetry.json()).toMatchObject({
    operationId: rename.operationId,
    status: "succeeded",
  });
  const destinations = await Promise.all(
    ["Left", "Right"].map(
      async (name) =>
        (await service.createFolder({ ...actor, parentId: root.id, name }))
          .folder,
    ),
  );
  const moveKey = randomUUID();
  const moved = await request("move", moveKey, {
    destinationFolderId: destinations[0]!.id,
  });
  expect(moved.status).toBe(202);
  const move = await moved.json();
  const changedTarget = await request("move", moveKey, {
    destinationFolderId: destinations[1]!.id,
  });
  expect(changedTarget.status).toBe(409);
  expect(await changedTarget.json()).toMatchObject({
    code: "STORAGE_IDEMPOTENCY_KEY_REUSED",
  });
  await settled(move.operationId, id);
  expect(
    await db.folder.findUniqueOrThrow({ where: { id: folder.id } }),
  ).toMatchObject({ name: "First", parentId: destinations[0]!.id });
  const saved = await db.file.findUniqueOrThrow({
    where: { id: files[0]!.id },
  });
  expect(await readFile(getStoragePath(saved.storageKey))).toEqual(bytes);
}, 120_000);

it("refuses sync snapshots of subfolders already deleted by a commit chunk", async () => {
  const { id, root, actor } = await createOwner();
  const { folder, subfolders } = await seedLargeFolder(id, root.id);
  const { sessionToken } = await authService.createSession(id, {});
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` };
  let checked = false;
  faults.boundary = async (boundary) => {
    if (boundary !== "metadata_chunk_applied") return;
    checked = true;
    const child = await db.folder.findUniqueOrThrow({
      where: { id: subfolders[0]!.id },
    });
    expect(child.deletedAt).not.toBeNull();
    expect(
      (await db.folder.findUniqueOrThrow({ where: { id: folder.id } }))
        .deletedAt,
    ).toBeNull();
    for (const folderId of [root.id, folder.id, child.id]) {
      const response = await app.request(
        `/api/sync/snapshot?folderId=${folderId}`,
        { headers },
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "STORAGE_MUTATION_RECOVERING",
      });
    }
    throw new StorageMutationAbruptInterruptionError("metadata_chunk_applied");
  };
  try {
    await expect(
      service.trashFolder({ ...actor, folderId: folder.id }),
    ).rejects.toMatchObject({ code: "STORAGE_MUTATION_RECOVERING" });
    expect(checked).toBe(true);
  } finally {
    faults.boundary = undefined;
  }
  const mutation = await latestMutation(id, "folder_trash");
  await db.storageMutation.update({
    where: { id: mutation.id },
    data: { leaseExpiresAt: new Date(0) },
  });
  await recoverStorageMutations({ storagePaths: storagePaths() });
  expect((await latestMutation(id, "folder_trash")).status).toBe("succeeded");
  expect(
    (
      await app.request(`/api/sync/snapshot?folderId=${subfolders[0]!.id}`, {
        headers,
      })
    ).status,
  ).toBe(404);
}, 120_000);
