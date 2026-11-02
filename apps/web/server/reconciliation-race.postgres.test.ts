import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, expect, inject, it } from "vite-plus/test";
import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  findRestoreReconciliationRunByBackgroundJobId,
  readReconciliationOrphanState,
  saveReconciledFileStatuses,
} from "@staaash/db/reconciliation";
import {
  applyStorageMutationIntentMetadata,
  prepareStorageMutation,
} from "@staaash/db/storage-mutations";
import { claimAndExecuteStorageMutation } from "@staaash/db/storage-mutation-executor";
import { handleRestoreReconciliation } from "../../worker/src/handlers/restore-reconciliation.js";
import { assertIsolatedPostgresTestTarget } from "../vitest.postgres.global";

beforeEach(async () => {
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });
  const db = getPrisma();
  await db.storageMutation.deleteMany();
  await db.user.deleteMany();
});

it("retries a restore check when a file moves after the snapshot", async () => {
  const db = getPrisma();
  const id = randomUUID();
  const root = path.join(inject("postgresStorageRoot"), `case-${id}`);
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@test.invalid`,
      storageId: id,
      passwordHash: "test",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const sourceKey = `files/${id}/Original.txt`;
  const targetKey = `files/${id}/Renamed.txt`;
  const bytes = Buffer.from("fake file bytes");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await mkdir(path.dirname(path.join(root, sourceKey)), { recursive: true });
  await writeFile(path.join(root, sourceKey), bytes);
  const file = await db.file.create({
    data: {
      ownerUserId: user.id,
      folderId: folder.id,
      originalName: "Original.txt",
      storageKey: sourceKey,
      mimeType: "text/plain",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
    },
  });
  const prepared = await prepareStorageMutation({
    kind: "file_rename",
    ownerUserId: user.id,
    intentJson: {
      version: 1,
      metadataOperations: [
        {
          action: "update",
          entityType: "file",
          entityId: file.id,
          preRevision: 0,
          data: { originalName: "Renamed.txt", storageKey: targetKey },
        },
      ],
    } as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(bytes.length),
        expectedChecksum: checksum,
      },
    ],
    entities: [
      {
        entityType: "file",
        entityId: file.id,
        preRevision: 0,
        postRevision: 1,
      },
    ],
  });
  const job = await db.backgroundJob.create({
    data: { kind: "restore.reconcile", payloadJson: {}, runAt: new Date() },
  });
  const paths = {
    filesRoot: root,
    tmpRoot: path.join(root, "tmp"),
    heartbeatPath: path.join(root, "tmp/heartbeat"),
    pendingDeleteRoot: path.join(root, "tmp/deletes"),
    uploadStagingTtlMs: 1,
  };
  let moved = false;
  const client = {
    file: {
      findMany: async (args: object) => {
        const snapshot = await db.file.findMany(args);
        if (!moved) {
          moved = true;
          await claimAndExecuteStorageMutation({
            mutationId: prepared.mutation.id,
            filesRoot: root,
            leaseOwner: `test:${id}`,
            commitMetadata: (tx) =>
              applyStorageMutationIntentMetadata(
                tx,
                prepared.mutation.intentJson,
              ),
          });
        }
        return snapshot;
      },
      updateMany: (args: Parameters<typeof db.file.updateMany>[0]) =>
        db.file.updateMany(args),
    },
    storageMutationStep: db.storageMutationStep,
    storageMutation: db.storageMutation,
    storageMutationEntity: db.storageMutationEntity,
    mediaDerivative: db.mediaDerivative,
    zipArchive: db.zipArchive,
    uploadSession: db.uploadSession,
    backgroundJob: db.backgroundJob,
  };
  await expect(
    handleRestoreReconciliation(job, paths, client),
  ).rejects.toThrow();
  expect(await readFile(path.join(root, targetKey))).toEqual(bytes);
  expect(
    await db.file.findUniqueOrThrow({ where: { id: file.id } }),
  ).toMatchObject({ storageKey: targetKey, storageStatus: "available" });
  await handleRestoreReconciliation(job, paths, db);
  const report = await db.restoreReconciliationRun.findUniqueOrThrow({
    where: { backgroundJobId: job.id },
  });
  expect(report).toMatchObject({
    status: "succeeded",
    missingOriginalCount: 0,
    orphanedStorageCount: 0,
  });
});

it("does not mark a file missing while its journaled rename is between disk and metadata", async () => {
  const db = getPrisma();
  const id = randomUUID();
  const root = path.join(inject("postgresStorageRoot"), `case-${id}`);
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@test.invalid`,
      storageId: id,
      passwordHash: "test",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const sourceKey = `files/${id}/before.txt`;
  const targetKey = `files/${id}/after.txt`;
  const bytes = Buffer.from("fake content");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await mkdir(path.dirname(path.join(root, sourceKey)), { recursive: true });
  await writeFile(path.join(root, sourceKey), bytes);
  const file = await db.file.create({
    data: {
      ownerUserId: id,
      folderId: folder.id,
      originalName: "before.txt",
      storageKey: sourceKey,
      mimeType: "text/plain",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
    },
  });
  const mutation = await prepareStorageMutation({
    kind: "file_rename",
    ownerUserId: id,
    intentJson: {
      version: 1,
      metadataOperations: [
        {
          action: "update",
          entityType: "file",
          entityId: file.id,
          preRevision: 0,
          data: { originalName: "after.txt", storageKey: targetKey },
        },
      ],
    } as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(bytes.length),
        expectedChecksum: checksum,
      },
    ],
    entities: [
      {
        entityType: "file",
        entityId: file.id,
        preRevision: 0,
        postRevision: 1,
      },
    ],
  });
  const job = await db.backgroundJob.create({
    data: { kind: "restore.reconcile", payloadJson: {}, runAt: new Date() },
  });
  await handleRestoreReconciliation(
    job,
    {
      filesRoot: root,
      tmpRoot: path.join(root, "tmp"),
      heartbeatPath: path.join(root, "tmp/heartbeat"),
      pendingDeleteRoot: path.join(root, "tmp/deletes"),
      uploadStagingTtlMs: 1,
    },
    db,
  );
  expect(
    await db.restoreReconciliationRun.findUniqueOrThrow({
      where: { backgroundJobId: job.id },
    }),
  ).toMatchObject({
    detailsJson: expect.objectContaining({ uncheckedOriginalCount: 1 }),
  });
  expect(
    await findRestoreReconciliationRunByBackgroundJobId(job.id),
  ).toMatchObject({
    details: { uncheckedOriginalCount: 1 },
  });
  let checked = false;
  await claimAndExecuteStorageMutation({
    mutationId: mutation.mutation.id,
    filesRoot: root,
    leaseOwner: `test:${id}`,
    commitMetadata: (tx) =>
      applyStorageMutationIntentMetadata(tx, mutation.mutation.intentJson),
    executionHook: async (boundary) => {
      if (boundary !== "forward_steps_applied") return;
      checked = true;
      await expect(
        saveReconciledFileStatuses({
          files: [file],
          missingIds: [file.id],
          checkedAt: new Date(),
        }),
      ).rejects.toThrow();
      const state = await readReconciliationOrphanState([targetKey]);
      expect(state.steps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sourceKey, targetKey }),
        ]),
      );
      expect(
        await db.file.findUniqueOrThrow({ where: { id: file.id } }),
      ).toMatchObject({ storageKey: sourceKey, storageStatus: "available" });
    },
  });
  expect(checked).toBe(true);
  expect(await readFile(path.join(root, targetKey))).toEqual(bytes);
  expect(
    await db.file.findUniqueOrThrow({ where: { id: file.id } }),
  ).toMatchObject({ storageKey: targetKey, storageStatus: "available" });
  expect((await readReconciliationOrphanState([targetKey])).files).toEqual([
    { storageKey: targetKey },
  ]);
});

it("still reports real missing files, checksum errors and orphaned files", async () => {
  const db = getPrisma();
  const id = randomUUID();
  const root = path.join(inject("postgresStorageRoot"), `case-${id}`);
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@test.invalid`,
      storageId: id,
      passwordHash: "test",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const keys = ["present.txt", "missing.txt", "corrupt.txt", "orphan.txt"].map(
    (name) => `files/${id}/${name}`,
  );
  await mkdir(path.join(root, "files", id), { recursive: true });
  await writeFile(path.join(root, keys[0]!), "good");
  await writeFile(path.join(root, keys[2]!), "wrong");
  await writeFile(path.join(root, keys[3]!), "orphan");
  const checksum = createHash("sha256").update("good").digest("hex");
  const create = (name: string, key: string, status: "available" | "missing") =>
    db.file.create({
      data: {
        ownerUserId: id,
        folderId: folder.id,
        originalName: name,
        storageKey: key,
        mimeType: "text/plain",
        sizeBytes: 4n,
        contentChecksum: checksum,
        storageStatus: status,
      },
    });
  const present = await create("present.txt", keys[0]!, "missing");
  const missing = await create("missing.txt", keys[1]!, "available");
  const corrupt = await create("corrupt.txt", keys[2]!, "available");
  const job = await db.backgroundJob.create({
    data: { kind: "restore.reconcile", payloadJson: {}, runAt: new Date() },
  });
  await handleRestoreReconciliation(
    job,
    {
      filesRoot: root,
      tmpRoot: path.join(root, "tmp"),
      heartbeatPath: path.join(root, "tmp/heartbeat"),
      pendingDeleteRoot: path.join(root, "tmp/deletes"),
      uploadStagingTtlMs: 1,
    },
    db,
  );
  expect(
    await db.file.findUniqueOrThrow({ where: { id: present.id } }),
  ).toMatchObject({ storageStatus: "available" });
  expect(
    await db.file.findUniqueOrThrow({ where: { id: missing.id } }),
  ).toMatchObject({ storageStatus: "missing" });
  expect(
    await db.file.findUniqueOrThrow({ where: { id: corrupt.id } }),
  ).toMatchObject({ storageStatus: "missing" });
  expect(
    await db.restoreReconciliationRun.findUniqueOrThrow({
      where: { backgroundJobId: job.id },
    }),
  ).toMatchObject({
    status: "succeeded",
    missingOriginalCount: 1,
    orphanedStorageCount: 1,
    detailsJson: expect.objectContaining({
      missingOriginals: [
        { fileId: missing.id, storageKey: "files/…/missing.txt" },
      ],
      checksumMismatches: [
        { fileId: corrupt.id, storageKey: "files/…/corrupt.txt" },
      ],
      orphanedStorageKeys: ["files/…/orphan.txt"],
    }),
  });
});

it("does not report a newly committed upload as an orphan", async () => {
  const db = getPrisma();
  const id = randomUUID();
  const root = path.join(inject("postgresStorageRoot"), `case-${id}`);
  await db.user.create({
    data: {
      id,
      email: `${id}@test.invalid`,
      storageId: id,
      passwordHash: "test",
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  const sourceKey = `tmp/issue-421-${id}/staged`;
  const targetKey = `files/${id}/new-upload.txt`;
  const bytes = Buffer.from("fake uploaded data");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  await mkdir(path.dirname(path.join(root, sourceKey)), { recursive: true });
  await mkdir(path.dirname(path.join(root, targetKey)), { recursive: true });
  await writeFile(path.join(root, sourceKey), bytes);
  const fileId = randomUUID();
  const mutation = await prepareStorageMutation({
    kind: "upload_create",
    ownerUserId: id,
    intentJson: {
      version: 1,
      metadataOperations: [
        {
          action: "create_file",
          data: {
            id: fileId,
            ownerUserId: id,
            folderId: folder.id,
            originalName: "new-upload.txt",
            storageKey: targetKey,
            mimeType: "text/plain",
            sizeBytes: String(bytes.length),
            contentChecksum: checksum,
          },
        },
      ],
    } as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(bytes.length),
        expectedChecksum: checksum,
      },
    ],
  });
  const job = await db.backgroundJob.create({
    data: { kind: "restore.reconcile", payloadJson: {}, runAt: new Date() },
  });
  let uploaded = false;
  const client = {
    file: {
      findMany: async (args: object) => {
        const snapshot = await db.file.findMany(args);
        if (!uploaded) {
          uploaded = true;
          await claimAndExecuteStorageMutation({
            mutationId: mutation.mutation.id,
            filesRoot: root,
            leaseOwner: `test:${id}`,
            commitMetadata: (tx) =>
              applyStorageMutationIntentMetadata(
                tx,
                mutation.mutation.intentJson,
              ),
          });
        }
        return snapshot;
      },
    },
    storageMutationStep: db.storageMutationStep,
    storageMutation: db.storageMutation,
    storageMutationEntity: db.storageMutationEntity,
    mediaDerivative: db.mediaDerivative,
    zipArchive: db.zipArchive,
    uploadSession: db.uploadSession,
    backgroundJob: db.backgroundJob,
  };
  await handleRestoreReconciliation(
    job,
    {
      filesRoot: root,
      tmpRoot: path.join(root, "tmp"),
      heartbeatPath: path.join(root, "tmp/heartbeat"),
      pendingDeleteRoot: path.join(root, "tmp/deletes"),
      uploadStagingTtlMs: 1,
    },
    client,
  );
  const report = await db.restoreReconciliationRun.findUniqueOrThrow({
    where: { backgroundJobId: job.id },
  });
  expect(report.detailsJson).not.toEqual(
    expect.objectContaining({
      orphanedStorageKeys: expect.arrayContaining(["files/…/new-upload.txt"]),
    }),
  );
  expect(await readFile(path.join(root, targetKey))).toEqual(bytes);
});
