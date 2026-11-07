import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "@staaash/db/client";
import { beforeAll, expect, it } from "vite-plus/test";
import { recoverStorageMutations } from "../../../worker/src/handlers/storage-mutation-recovery.js";
import { getStoragePath, getStorageRoot } from "../storage";
import { startClearTrash, toClearTrashOperationResponse } from "./clear-trash";
import { createFilesService } from "./service";

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

const createOwner = async () => {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `${id}@clear-trash.test`,
      storageId: id,
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}/Old`), { recursive: true });
  return { id, root, actor: { actorUserId: id, actorRole: "member" as const } };
};

const createStoredFile = async (
  ownerUserId: string,
  folderId: string,
  storageKey: string,
) => {
  const bytes = Buffer.from(`bytes of ${storageKey}`);
  await writeFile(getStoragePath(storageKey), bytes);
  return db.file.create({
    data: {
      ownerUserId,
      folderId,
      originalName: path.basename(storageKey),
      storageKey,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      contentChecksum: createHash("sha256").update(bytes).digest("hex"),
    },
  });
};

const runWorkerTrashLane = async () => {
  const storageRoot = getStorageRoot();
  await recoverStorageMutations({
    kinds: ["clear_trash"],
    storagePaths: {
      filesRoot: storageRoot,
      tmpRoot: path.join(storageRoot, "tmp"),
      heartbeatPath: path.join(storageRoot, "tmp", "worker-heartbeat.json"),
      pendingDeleteRoot: path.join(storageRoot, "tmp", "pending-delete"),
      uploadStagingTtlMs: 1,
    },
  });
};

it("empties the trash in the worker and reports progress", async () => {
  const { id, root, actor } = await createOwner();
  const folder = await db.folder.create({
    data: { ownerUserId: id, parentId: root.id, name: "Old" },
  });
  await createStoredFile(id, folder.id, `files/${id}/Old/a.txt`);
  const loose = await createStoredFile(id, root.id, `files/${id}/loose.txt`);
  const kept = await createStoredFile(id, root.id, `files/${id}/kept.txt`);
  await service.trashFolder({ ...actor, folderId: folder.id });
  await service.trashFile({ ...actor, fileId: loose.id });

  const started = await startClearTrash(actor, randomUUID());
  expect(started).toMatchObject({
    status: "queued",
    totalCount: 2,
    doneCount: 0,
  });
  // Pressing Empty trash again follows the run instead of waiting on its locks.
  await expect(startClearTrash(actor, randomUUID())).resolves.toMatchObject({
    operationId: started.operationId,
  });

  await runWorkerTrashLane();

  const parent = await db.storageMutation.findUniqueOrThrow({
    where: { id: started.operationId },
  });
  expect(toClearTrashOperationResponse(parent)).toEqual({
    operationId: started.operationId,
    status: "succeeded",
    totalCount: 2,
    doneCount: 2,
    response: { deletedFolderCount: 1, deletedFileCount: 2 },
  });
  await expect(
    db.file.count({ where: { ownerUserId: id, deletedAt: { not: null } } }),
  ).resolves.toBe(0);
  await expect(
    db.folder.findUnique({ where: { id: folder.id } }),
  ).resolves.toBeNull();
  await expect(
    access(getStoragePath(kept.storageKey)),
  ).resolves.toBeUndefined();
  // A finished run no longer captures new presses.
  await expect(startClearTrash(actor, randomUUID())).resolves.not.toMatchObject(
    { operationId: started.operationId },
  );
});

it("counts finished items while the run is under way", () => {
  expect(
    toClearTrashOperationResponse({
      id: "run",
      status: "running",
      intentJson: { orderedItems: [{}, {}, {}] },
      resultJson: { children: [{ ordinal: 0 }] },
    }),
  ).toEqual({
    operationId: "run",
    status: "running",
    totalCount: 3,
    doneCount: 1,
  });
});
