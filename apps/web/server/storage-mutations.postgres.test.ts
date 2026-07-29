import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  applyStorageMutationIntentMetadata,
  buildStorageMutationChildRequestHashPayload,
  claimStorageMutation,
  markStorageMutationStepApplied,
  prepareStorageMutation,
  prepareStorageMutationParent,
  recordStorageMutationParentChild,
  renewStorageMutationLease,
  StorageMutationConflictError,
  StorageMutationFenceError,
  type RecoverableStorageMutationIntent,
  type StorageMetadataOperation,
} from "@staaash/db/storage-mutations";
import {
  applyStorageMutationSteps,
  calculateCapturedTreeManifestDigest,
  claimAndExecuteStorageMutation,
  EMPTY_TREE_MANIFEST_DIGEST,
  StorageMutationAbruptInterruptionError,
  StorageMutationAmbiguityError,
  type StorageMutationExecutionBoundary,
} from "@staaash/db/storage-mutation-executor";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vitest";

import { recoverStorageMutations } from "../../worker/src/handlers/storage-mutation-recovery.js";
import { hashWorkerStorageRequest } from "../../worker/src/durable-storage-mutation.js";
import { assertIsolatedPostgresTestTarget } from "../vitest.postgres.global";

const db = getPrisma();
const storageRoot = () => inject("postgresStorageRoot");
const storagePaths = () => ({
  filesRoot: storageRoot(),
  tmpRoot: path.join(storageRoot(), "tmp"),
  heartbeatPath: path.join(storageRoot(), "tmp", "worker-heartbeat.json"),
  pendingDeleteRoot: path.join(storageRoot(), "tmp", "pending-delete"),
  uploadStagingTtlMs: 1,
});

const assertTestIsolation = () =>
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });

const createUser = async () => {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      email: `${id}@sto-02.test`,
      storageId: `storage-${id}`,
      passwordHash: "test-only",
    },
  });
};

const intent = (
  metadataOperations: StorageMetadataOperation[],
): RecoverableStorageMutationIntent => ({
  version: 1,
  metadataOperations,
});

const execute = async (
  mutation: Awaited<ReturnType<typeof prepareStorageMutation>>["mutation"],
  options: {
    leaseOwner?: string;
    beforeMetadata?: (tx: Prisma.TransactionClient) => Promise<void>;
  } = {},
) =>
  claimAndExecuteStorageMutation({
    mutationId: mutation.id,
    filesRoot: storageRoot(),
    leaseOwner: options.leaseOwner ?? `test:${randomUUID()}`,
    commitMetadata: async (tx) => {
      await options.beforeMetadata?.(tx);
      return applyStorageMutationIntentMetadata(tx, mutation.intentJson);
    },
  });

const forceMutationRecoveryNow = (mutationId: string) =>
  db.storageMutation.update({
    where: { id: mutationId },
    data: {
      leaseExpiresAt: new Date(0),
      nextAttemptAt: new Date(0),
    },
  });

type ExecutorFamily =
  | "ordinary upload create"
  | "resumable upload replace"
  | "file move"
  | "folder tree move"
  | "file purge"
  | "derivative replacement"
  | "archive replacement";

const executorBoundaryCases: Array<{
  family: ExecutorFamily;
  boundary: StorageMutationExecutionBoundary;
  phase: "forward" | "cleanup" | null;
}> = [
  {
    family: "ordinary upload create",
    boundary: "filesystem_step_applied",
    phase: "forward",
  },
  {
    family: "resumable upload replace",
    boundary: "forward_steps_applied",
    phase: null,
  },
  {
    family: "file move",
    boundary: "metadata_committed",
    phase: null,
  },
  {
    family: "folder tree move",
    boundary: "finalization_started",
    phase: null,
  },
  {
    family: "file purge",
    boundary: "filesystem_step_applied",
    phase: "cleanup",
  },
  {
    family: "derivative replacement",
    boundary: "cleanup_steps_applied",
    phase: null,
  },
  {
    family: "archive replacement",
    boundary: "completed",
    phase: null,
  },
];

type BoundaryFixture = {
  mutation: Awaited<ReturnType<typeof prepareStorageMutation>>["mutation"];
  assertInterrupted(): Promise<void>;
  assertRecovered(): Promise<void>;
};

const storagePath = (key: string) =>
  path.join(storageRoot(), ...key.split("/"));

const checksumOf = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

const expectStorageMissing = async (key: string) => {
  await expect(access(storagePath(key))).rejects.toMatchObject({
    code: "ENOENT",
  });
};

const expectStorageBytes = async (key: string, bytes: Buffer) => {
  await expect(readFile(storagePath(key))).resolves.toEqual(bytes);
};

const prepareOrdinaryUploadCreateFixture =
  async (): Promise<BoundaryFixture> => {
    const user = await createUser();
    const folder = await db.folder.create({
      data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
    });
    const fileId = randomUUID();
    const bytes = Buffer.from(`ordinary-upload-${fileId}`);
    const checksum = checksumOf(bytes);
    const sourceKey = `tmp/uploads/${fileId}.part`;
    const targetKey = `files/${user.storageId}/ordinary-${fileId}.bin`;
    await mkdir(path.dirname(storagePath(sourceKey)), { recursive: true });
    await writeFile(storagePath(sourceKey), bytes);
    const prepared = await prepareStorageMutation({
      kind: "upload_create",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([
        {
          action: "assert_owner_quota",
          ownerUserId: user.id,
          additionalBytes: String(bytes.length),
        },
        {
          action: "create_file",
          data: {
            id: fileId,
            ownerUserId: user.id,
            folderId: folder.id,
            originalName: "ordinary.bin",
            storageKey: targetKey,
            mimeType: "application/octet-stream",
            sizeBytes: String(bytes.length),
            contentChecksum: checksum,
          },
        },
      ]) as unknown as Prisma.InputJsonValue,
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
          entityId: fileId,
          preRevision: -1,
          postRevision: 0,
          beforeJson: null,
          afterJson: { storageKey: targetKey, contentChecksum: checksum },
        },
      ],
    });
    return {
      mutation: prepared.mutation,
      assertInterrupted: async () => {
        await expect(
          db.file.findUnique({ where: { id: fileId } }),
        ).resolves.toBeNull();
        await expectStorageMissing(sourceKey);
        await expectStorageBytes(targetKey, bytes);
        await expect(
          db.storageMutationStep.findUniqueOrThrow({
            where: { id: prepared.mutation.steps[0]!.id },
            select: { status: true },
          }),
        ).resolves.toEqual({ status: "pending" });
      },
      assertRecovered: async () => {
        await expect(
          db.file.findUniqueOrThrow({ where: { id: fileId } }),
        ).resolves.toMatchObject({
          storageKey: targetKey,
          contentChecksum: checksum,
          storageRevision: 0,
        });
        await expectStorageBytes(targetKey, bytes);
      },
    };
  };

const prepareResumableUploadReplaceFixture =
  async (): Promise<BoundaryFixture> => {
    const user = await createUser();
    const folder = await db.folder.create({
      data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
    });
    const fileId = randomUUID();
    const sessionId = randomUUID();
    const mutationId = randomUUID();
    const oldBytes = Buffer.from(`old-upload-${fileId}`);
    const newBytes = Buffer.from(`new-upload-${fileId}`);
    const oldChecksum = checksumOf(oldBytes);
    const newChecksum = checksumOf(newBytes);
    const targetKey = `files/${user.storageId}/replace-${fileId}.bin`;
    const sourceKey = `tmp/upload-sessions/${sessionId}.part`;
    const incomingKey = `tmp/incoming/${mutationId}/replace.bin`;
    const backupKey = `tmp/backup/${mutationId}/replace.bin`;
    await mkdir(path.dirname(storagePath(sourceKey)), { recursive: true });
    await mkdir(path.dirname(storagePath(targetKey)), { recursive: true });
    await writeFile(storagePath(sourceKey), newBytes);
    await writeFile(storagePath(targetKey), oldBytes);
    await db.file.create({
      data: {
        id: fileId,
        ownerUserId: user.id,
        folderId: folder.id,
        originalName: "replace.bin",
        storageKey: targetKey,
        mimeType: "application/octet-stream",
        sizeBytes: BigInt(oldBytes.length),
        contentChecksum: oldChecksum,
      },
    });
    await db.uploadSession.create({
      data: {
        id: sessionId,
        ownerUserId: user.id,
        folderId: folder.id,
        originalName: "replace.bin",
        mimeType: "application/octet-stream",
        totalSizeBytes: BigInt(newBytes.length),
        receivedBytes: BigInt(newBytes.length),
        expectedChecksum: newChecksum,
        tmpPath: sourceKey,
        conflictStrategy: "replace",
        status: "committing",
        expiresAt: new Date("2030-08-01T00:00:00.000Z"),
      },
    });
    const completedAt = new Date("2030-07-28T12:00:00.000Z");
    const prepared = await prepareStorageMutation({
      id: mutationId,
      kind: "upload_replace",
      ownerUserId: user.id,
      idempotencyKey: `resumable:${sessionId}:complete`,
      requestHash: randomUUID(),
      uploadSessionId: sessionId,
      intentJson: intent([
        {
          action: "update",
          entityType: "file",
          entityId: fileId,
          preRevision: 0,
          data: {
            mimeType: "application/octet-stream",
            sizeBytes: String(newBytes.length),
            contentChecksum: newChecksum,
            folderId: folder.id,
          },
        },
        {
          action: "complete_upload_session",
          entityId: sessionId,
          ownerUserId: user.id,
          committedFileId: fileId,
          completedAt: completedAt.toISOString(),
          storageMutationId: mutationId,
        },
      ]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey: incomingKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(newBytes.length),
          expectedChecksum: newChecksum,
        },
        {
          action: "rename",
          sourceKey: targetKey,
          targetKey: backupKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(oldBytes.length),
          expectedChecksum: oldChecksum,
        },
        {
          action: "rename",
          sourceKey: incomingKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(newBytes.length),
          expectedChecksum: newChecksum,
        },
        {
          action: "delete_file",
          targetKey: backupKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(oldBytes.length),
          expectedChecksum: oldChecksum,
        },
      ],
      entities: [
        {
          entityType: "file",
          entityId: fileId,
          preRevision: 0,
          postRevision: 1,
          beforeJson: { contentChecksum: oldChecksum },
          afterJson: { contentChecksum: newChecksum },
        },
        {
          entityType: "upload_session",
          entityId: sessionId,
          preRevision: 0,
          postRevision: 0,
          beforeJson: { status: "committing" },
          afterJson: { status: "completed", committedFileId: fileId },
        },
      ],
    });
    return {
      mutation: prepared.mutation,
      assertInterrupted: async () => {
        await expect(
          db.file.findUniqueOrThrow({ where: { id: fileId } }),
        ).resolves.toMatchObject({
          contentChecksum: oldChecksum,
          storageRevision: 0,
        });
        await expect(
          db.uploadSession.findUniqueOrThrow({ where: { id: sessionId } }),
        ).resolves.toMatchObject({
          status: "committing",
          committedFileId: null,
          storageMutationId: mutationId,
        });
        await expectStorageBytes(targetKey, newBytes);
        await expectStorageBytes(backupKey, oldBytes);
        await expectStorageMissing(sourceKey);
        await expectStorageMissing(incomingKey);
      },
      assertRecovered: async () => {
        await expect(
          db.file.findUniqueOrThrow({ where: { id: fileId } }),
        ).resolves.toMatchObject({
          sizeBytes: BigInt(newBytes.length),
          contentChecksum: newChecksum,
          storageRevision: 1,
        });
        await expect(
          db.uploadSession.findUniqueOrThrow({ where: { id: sessionId } }),
        ).resolves.toMatchObject({
          status: "completed",
          terminalAt: completedAt,
          stagingReleasedAt: completedAt,
          committedFileId: fileId,
          storageMutationId: mutationId,
        });
        await expectStorageBytes(targetKey, newBytes);
        await expectStorageMissing(backupKey);
      },
    };
  };

const prepareFileMoveFixture = async (): Promise<BoundaryFixture> => {
  const user = await createUser();
  const sourceFolder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Source" },
  });
  const destinationFolder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Destination" },
  });
  const fileId = randomUUID();
  const bytes = Buffer.from(`file-move-${fileId}`);
  const checksum = checksumOf(bytes);
  const sourceKey = `files/${user.storageId}/Source/move.bin`;
  const targetKey = `files/${user.storageId}/Destination/move.bin`;
  await mkdir(path.dirname(storagePath(sourceKey)), { recursive: true });
  await writeFile(storagePath(sourceKey), bytes);
  await db.file.create({
    data: {
      id: fileId,
      ownerUserId: user.id,
      folderId: sourceFolder.id,
      originalName: "move.bin",
      storageKey: sourceKey,
      mimeType: "application/octet-stream",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
    },
  });
  const prepared = await prepareStorageMutation({
    kind: "file_move",
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: intent([
      {
        action: "update",
        entityType: "file",
        entityId: fileId,
        preRevision: 0,
        data: { folderId: destinationFolder.id, storageKey: targetKey },
      },
    ]) as unknown as Prisma.InputJsonValue,
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
        entityId: fileId,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { folderId: sourceFolder.id, storageKey: sourceKey },
        afterJson: { folderId: destinationFolder.id, storageKey: targetKey },
      },
    ],
  });
  const assertMoved = async () => {
    await expect(
      db.file.findUniqueOrThrow({ where: { id: fileId } }),
    ).resolves.toMatchObject({
      folderId: destinationFolder.id,
      storageKey: targetKey,
      storageRevision: 1,
    });
    await expectStorageMissing(sourceKey);
    await expectStorageBytes(targetKey, bytes);
  };
  return {
    mutation: prepared.mutation,
    assertInterrupted: assertMoved,
    assertRecovered: assertMoved,
  };
};

const prepareFolderTreeMoveFixture = async (): Promise<BoundaryFixture> => {
  const user = await createUser();
  const sourceParent = await db.folder.create({
    data: { ownerUserId: user.id, name: "Source" },
  });
  const destinationParent = await db.folder.create({
    data: { ownerUserId: user.id, name: "Destination" },
  });
  const movedFolder = await db.folder.create({
    data: {
      ownerUserId: user.id,
      parentId: sourceParent.id,
      name: "Tree",
    },
  });
  const fileId = randomUUID();
  const bytes = Buffer.from(`folder-tree-${fileId}`);
  const checksum = checksumOf(bytes);
  const sourceKey = `files/${user.storageId}/Source/Tree`;
  const targetKey = `files/${user.storageId}/Destination/Tree`;
  const oldFileKey = `${sourceKey}/child.bin`;
  const newFileKey = `${targetKey}/child.bin`;
  await mkdir(storagePath(sourceKey), { recursive: true });
  await writeFile(storagePath(oldFileKey), bytes);
  await db.file.create({
    data: {
      id: fileId,
      ownerUserId: user.id,
      folderId: movedFolder.id,
      originalName: "child.bin",
      storageKey: oldFileKey,
      mimeType: "application/octet-stream",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
    },
  });
  const treeDigest = calculateCapturedTreeManifestDigest([
    {
      kind: "file",
      relativeKey: "child.bin",
      sizeBytes: BigInt(bytes.length),
      checksum,
    },
  ]);
  const prepared = await prepareStorageMutation({
    kind: "folder_move",
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: intent([
      {
        action: "update",
        entityType: "folder",
        entityId: movedFolder.id,
        preRevision: 0,
        data: { parentId: destinationParent.id },
      },
      {
        action: "update",
        entityType: "file",
        entityId: fileId,
        preRevision: 0,
        data: { storageKey: newFileKey },
      },
    ]) as unknown as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey,
        expectedNodeType: "directory",
        treeManifestDigest: treeDigest,
      },
    ],
    entities: [
      {
        entityType: "folder",
        entityId: movedFolder.id,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { parentId: sourceParent.id },
        afterJson: { parentId: destinationParent.id },
      },
      {
        entityType: "file",
        entityId: fileId,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { storageKey: oldFileKey },
        afterJson: { storageKey: newFileKey },
      },
      {
        entityType: "folder",
        entityId: destinationParent.id,
        preRevision: 0,
        postRevision: 0,
        beforeJson: null,
        afterJson: null,
      },
    ],
  });
  const assertMoved = async () => {
    await expect(
      db.folder.findUniqueOrThrow({ where: { id: movedFolder.id } }),
    ).resolves.toMatchObject({
      parentId: destinationParent.id,
      storageRevision: 1,
    });
    await expect(
      db.file.findUniqueOrThrow({ where: { id: fileId } }),
    ).resolves.toMatchObject({
      storageKey: newFileKey,
      storageRevision: 1,
    });
    await expectStorageMissing(sourceKey);
    await expectStorageBytes(newFileKey, bytes);
  };
  return {
    mutation: prepared.mutation,
    assertInterrupted: assertMoved,
    assertRecovered: assertMoved,
  };
};

const prepareFilePurgeFixture = async (): Promise<BoundaryFixture> => {
  const user = await createUser();
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const fileId = randomUUID();
  const mutationId = randomUUID();
  const bytes = Buffer.from(`purge-${fileId}`);
  const checksum = checksumOf(bytes);
  const sourceKey = `.trash/${user.storageId}/files/purge-${fileId}.bin`;
  const quarantineKey = `tmp/quarantine/${mutationId}/blob`;
  await mkdir(path.dirname(storagePath(sourceKey)), { recursive: true });
  await writeFile(storagePath(sourceKey), bytes);
  await db.file.create({
    data: {
      id: fileId,
      ownerUserId: user.id,
      folderId: folder.id,
      originalName: "purge.bin",
      storageKey: sourceKey,
      mimeType: "application/octet-stream",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
      deletedAt: new Date("2030-07-01T00:00:00.000Z"),
    },
  });
  const prepared = await prepareStorageMutation({
    id: mutationId,
    kind: "file_purge",
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: intent([
      {
        action: "delete",
        entityType: "file",
        entityId: fileId,
        preRevision: 0,
      },
    ]) as unknown as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey: quarantineKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(bytes.length),
        expectedChecksum: checksum,
      },
      {
        action: "delete_file",
        targetKey: quarantineKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(bytes.length),
        expectedChecksum: checksum,
      },
    ],
    entities: [
      {
        entityType: "file",
        entityId: fileId,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { storageKey: sourceKey },
        afterJson: null,
      },
    ],
  });
  const assertPurged = async () => {
    await expect(
      db.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();
    await expectStorageMissing(sourceKey);
    await expectStorageMissing(quarantineKey);
  };
  return {
    mutation: prepared.mutation,
    assertInterrupted: async () => {
      await assertPurged();
      await expect(
        db.storageMutationStep.findUniqueOrThrow({
          where: { id: prepared.mutation.steps[1]!.id },
          select: { status: true },
        }),
      ).resolves.toEqual({ status: "pending" });
    },
    assertRecovered: assertPurged,
  };
};

const prepareGeneratedReplacementFixture = async (
  entityType: "derivative" | "archive",
): Promise<BoundaryFixture> => {
  const user = await createUser();
  const mutationId = randomUUID();
  const oldBytes = Buffer.from(`old-${entityType}-${mutationId}`);
  const newBytes = Buffer.from(`new-${entityType}-${mutationId}`);
  const oldChecksum = checksumOf(oldBytes);
  const newChecksum = checksumOf(newBytes);
  let entityId: string;
  let kind: "derivative_publish" | "archive_publish";
  let targetKey: string;
  if (entityType === "derivative") {
    const folder = await db.folder.create({
      data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
    });
    const file = await db.file.create({
      data: {
        ownerUserId: user.id,
        folderId: folder.id,
        originalName: "source.bin",
        storageKey: `files/${user.storageId}/source.bin`,
        mimeType: "application/octet-stream",
        sizeBytes: 1n,
      },
    });
    const derivative = await db.mediaDerivative.create({
      data: {
        fileId: file.id,
        kind: "preview",
        profile: "boundary",
        status: "processing",
      },
    });
    entityId = derivative.id;
    kind = "derivative_publish";
    targetKey = `derivatives/${user.id}/${file.id}/boundary.bin`;
  } else {
    const archive = await db.zipArchive.create({
      data: {
        userId: user.id,
        contentKey: randomUUID(),
        idsJson: { fileIds: [], folderIds: [] },
        status: "processing",
        expiresAt: new Date("2030-08-01T00:00:00.000Z"),
      },
    });
    entityId = archive.id;
    kind = "archive_publish";
    targetKey = `archives/${archive.id}.zip`;
  }
  const sourceKey = `tmp/${entityType}s/${entityId}.tmp`;
  const incomingKey = `tmp/incoming/${mutationId}/${path.posix.basename(targetKey)}`;
  const backupKey = `tmp/backup/${mutationId}/${path.posix.basename(targetKey)}`;
  await mkdir(path.dirname(storagePath(sourceKey)), { recursive: true });
  await mkdir(path.dirname(storagePath(targetKey)), { recursive: true });
  await writeFile(storagePath(sourceKey), newBytes);
  await writeFile(storagePath(targetKey), oldBytes);
  const metadata: Record<string, string | number | boolean | null> =
    entityType === "derivative"
      ? {
          status: "ready",
          storageKey: targetKey,
          mimeType: "application/octet-stream",
          sizeBytes: String(newBytes.length),
          width: null,
          height: null,
          durationSeconds: null,
          videoCodec: null,
          audioCodec: null,
          error: null,
          generatedAt: "2030-07-28T12:00:00.000Z",
        }
      : {
          status: "ready",
          storageKey: targetKey,
          fileName: "boundary.zip",
          sizeBytes: String(newBytes.length),
          fileCount: 0,
          error: null,
        };
  const prepared = await prepareStorageMutation({
    id: mutationId,
    kind,
    ownerUserId: user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: intent([
      {
        action: "update",
        entityType,
        entityId,
        preRevision: 0,
        data: metadata,
      },
    ]) as unknown as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey,
        targetKey: incomingKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(newBytes.length),
        expectedChecksum: newChecksum,
      },
      {
        action: "rename",
        sourceKey: targetKey,
        targetKey: backupKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(oldBytes.length),
        expectedChecksum: oldChecksum,
      },
      {
        action: "rename",
        sourceKey: incomingKey,
        targetKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(newBytes.length),
        expectedChecksum: newChecksum,
      },
      {
        action: "delete_file",
        targetKey: backupKey,
        expectedNodeType: "file",
        expectedSizeBytes: BigInt(oldBytes.length),
        expectedChecksum: oldChecksum,
      },
    ],
    entities: [
      {
        entityType,
        entityId,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { status: "processing" },
        afterJson: metadata,
      },
    ],
  });
  const assertPublished = async () => {
    const record =
      entityType === "derivative"
        ? await db.mediaDerivative.findUniqueOrThrow({
            where: { id: entityId },
          })
        : await db.zipArchive.findUniqueOrThrow({ where: { id: entityId } });
    expect(record).toMatchObject({
      status: "ready",
      storageKey: targetKey,
      storageRevision: 1,
    });
    await expectStorageBytes(targetKey, newBytes);
    await expectStorageMissing(sourceKey);
    await expectStorageMissing(incomingKey);
    await expectStorageMissing(backupKey);
  };
  return {
    mutation: prepared.mutation,
    assertInterrupted: assertPublished,
    assertRecovered: assertPublished,
  };
};

const prepareBoundaryFixture = async (
  family: ExecutorFamily,
): Promise<BoundaryFixture> => {
  switch (family) {
    case "ordinary upload create":
      return prepareOrdinaryUploadCreateFixture();
    case "resumable upload replace":
      return prepareResumableUploadReplaceFixture();
    case "file move":
      return prepareFileMoveFixture();
    case "folder tree move":
      return prepareFolderTreeMoveFixture();
    case "file purge":
      return prepareFilePurgeFixture();
    case "derivative replacement":
      return prepareGeneratedReplacementFixture("derivative");
    case "archive replacement":
      return prepareGeneratedReplacementFixture("archive");
  }
};

beforeAll(async () => {
  assertTestIsolation();
  await mkdir(storageRoot(), { recursive: true });
});

beforeEach(async () => {
  assertTestIsolation();
  await db.storageMutation.deleteMany();
  await db.user.deleteMany();
  for (const entry of await (
    await import("node:fs/promises")
  ).readdir(storageRoot())) {
    await rm(path.join(storageRoot(), entry), { recursive: true, force: true });
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("STO-02 durable PostgreSQL protocol", () => {
  it("keeps the isolated trash-root partial unique index installed", async () => {
    const rows = await db.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname = 'TrashEntry_isolated_storageRootKey_key'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain("UNIQUE INDEX");
    expect(rows[0]!.indexdef).toContain('"storageRootKey"');
    expect(rows[0]!.indexdef).toContain('"layoutVersion"');
    expect(rows[0]!.indexdef).toContain("isolated");
  });

  it("bulk-commits generated metadata with null casts under a non-UTC session", async () => {
    const user = await createUser();
    const folder = await db.folder.create({
      data: {
        ownerUserId: user.id,
        name: "Files",
        isFilesRoot: true,
      },
    });
    const file = await db.file.create({
      data: {
        ownerUserId: user.id,
        folderId: folder.id,
        originalName: "source.bin",
        storageKey: `files/${user.storageId}/source.bin`,
        mimeType: "application/octet-stream",
        sizeBytes: 1n,
      },
    });
    const derivative = await db.mediaDerivative.create({
      data: {
        fileId: file.id,
        kind: "preview",
        profile: "test",
        status: "processing",
      },
    });
    const archive = await db.zipArchive.create({
      data: {
        userId: user.id,
        contentKey: randomUUID(),
        idsJson: [],
        status: "building",
        expiresAt: new Date("2030-08-01T00:00:00.000Z"),
      },
    });
    const generatedAt = "2030-07-20T12:34:56.789Z";
    const operations: StorageMetadataOperation[] = [
      {
        action: "update",
        entityType: "derivative",
        entityId: derivative.id,
        preRevision: 0,
        data: {
          status: "ready",
          storageKey: `derivatives/${user.id}/preview.mp4`,
          mimeType: "video/mp4",
          sizeBytes: "123",
          width: 1280,
          height: 720,
          durationSeconds: 12.5,
          videoCodec: "h264",
          audioCodec: null,
          error: null,
          generatedAt,
        },
      },
      {
        action: "update",
        entityType: "archive",
        entityId: archive.id,
        preRevision: 0,
        data: {
          status: "ready",
          storageKey: `archives/${user.id}/bundle.zip`,
          fileName: "bundle.zip",
          sizeBytes: "456",
          fileCount: 2,
          error: null,
        },
      },
    ];
    const prepared = await prepareStorageMutation({
      kind: "derivative_publish",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent(operations) as unknown as Prisma.InputJsonValue,
      steps: [],
    });

    await execute(prepared.mutation, {
      beforeMetadata: (tx) =>
        tx
          .$executeRawUnsafe("SET LOCAL TIME ZONE 'Pacific/Auckland'")
          .then(() => undefined),
    });

    await expect(
      db.mediaDerivative.findUniqueOrThrow({
        where: { id: derivative.id },
      }),
    ).resolves.toMatchObject({
      status: "ready",
      sizeBytes: 123n,
      width: 1280,
      height: 720,
      durationSeconds: 12.5,
      videoCodec: "h264",
      audioCodec: null,
      error: null,
      generatedAt: new Date(generatedAt),
      storageRevision: 1,
    });
    await expect(
      db.zipArchive.findUniqueOrThrow({ where: { id: archive.id } }),
    ).resolves.toMatchObject({
      status: "ready",
      fileName: "bundle.zip",
      sizeBytes: 456n,
      fileCount: 2,
      error: null,
      storageRevision: 1,
    });
  });

  it("serializes same-owner namespace plans while unrelated owners proceed", async () => {
    const [firstUser, secondUser] = await Promise.all([
      createUser(),
      createUser(),
    ]);
    const [firstRoot, secondRoot] = await Promise.all([
      db.folder.create({
        data: {
          ownerUserId: firstUser.id,
          name: "Files",
          isFilesRoot: true,
        },
      }),
      db.folder.create({
        data: {
          ownerUserId: secondUser.id,
          name: "Files",
          isFilesRoot: true,
        },
      }),
    ]);
    const prepareCreate = (
      userId: string,
      storageId: string,
      folderId: string,
      name: string,
    ) =>
      prepareStorageMutation({
        kind: "upload_create",
        ownerUserId: userId,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        intentJson: intent([
          {
            action: "create_file",
            data: {
              id: randomUUID(),
              ownerUserId: userId,
              folderId,
              originalName: name,
              storageKey: `files/${storageId}/${randomUUID()}.bin`,
              mimeType: "application/octet-stream",
              sizeBytes: "1",
              contentChecksum: null,
            },
          },
        ]) as unknown as Prisma.InputJsonValue,
        steps: [],
      });

    const sameOwner = await Promise.allSettled([
      prepareCreate(
        firstUser.id,
        firstUser.storageId,
        firstRoot.id,
        "same.bin",
      ),
      prepareCreate(
        firstUser.id,
        firstUser.storageId,
        firstRoot.id,
        "same.bin",
      ),
    ]);
    expect(
      sameOwner.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      sameOwner.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);

    const otherOwner = await prepareCreate(
      secondUser.id,
      secondUser.storageId,
      secondRoot.id,
      "same.bin",
    );
    expect(otherOwner.replayed).toBe(false);
  });

  it("takes over expired leases and rejects a stale fencing token", async () => {
    const user = await createUser();
    const prepared = await prepareStorageMutation({
      kind: "file_rename",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [],
    });
    const now = new Date();
    const first = await claimStorageMutation({
      id: prepared.mutation.id,
      leaseOwner: "executor-a",
      now,
      leaseMs: 1_000,
    });
    expect(first?.leaseToken).toBe(1n);
    await expect(
      claimStorageMutation({
        id: prepared.mutation.id,
        leaseOwner: "executor-b",
        now: new Date(now.getTime() + 500),
      }),
    ).resolves.toBeNull();
    const second = await claimStorageMutation({
      id: prepared.mutation.id,
      leaseOwner: "executor-b",
      now: new Date(now.getTime() + 2_000),
    });
    expect(second?.leaseToken).toBe(2n);
    await expect(
      renewStorageMutationLease({
        id: prepared.mutation.id,
        leaseOwner: "executor-a",
        leaseToken: first!.leaseToken,
      }),
    ).rejects.toBeInstanceOf(StorageMutationFenceError);
  });

  it("serializes global recovery against every owner mutation", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    const global = await prepareStorageMutation({
      kind: "legacy_recovery",
      ownerUserId: firstUser.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      resourceKeys: ["storage:global-recovery"],
      steps: [],
    });

    await expect(
      prepareStorageMutation({
        kind: "file_move",
        ownerUserId: secondUser.id,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        intentJson: intent([]) as unknown as Prisma.InputJsonValue,
        steps: [],
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_RECOVERY_REQUIRED",
      mutationId: global.mutation.id,
    });

    await db.storageMutation.delete({ where: { id: global.mutation.id } });
    const owner = await prepareStorageMutation({
      kind: "file_move",
      ownerUserId: secondUser.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [],
    });
    await expect(
      prepareStorageMutation({
        kind: "legacy_recovery",
        ownerUserId: firstUser.id,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        intentJson: intent([]) as unknown as Prisma.InputJsonValue,
        resourceKeys: ["storage:global-recovery"],
        steps: [],
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_RECOVERY_REQUIRED",
      mutationId: owner.mutation.id,
    });
  });

  it("rejects stale step and parent-result writes after lease takeover", async () => {
    const user = await createUser();
    const parent = await prepareStorageMutationParent({
      kind: "batch_move",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: { version: 1, metadataOperations: [], items: [] },
    });
    const stepMutation = await prepareStorageMutation({
      kind: "file_rename",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      resourceKeys: [],
      steps: [
        {
          action: "mkdir",
          targetKey: `tmp/${randomUUID()}`,
          expectedNodeType: "directory",
        },
      ],
    });
    const base = new Date();
    const firstParent = await claimStorageMutation({
      id: parent.mutation.id,
      leaseOwner: "parent-a",
      now: base,
      leaseMs: 1_000,
    });
    const firstStep = await claimStorageMutation({
      id: stepMutation.mutation.id,
      leaseOwner: "step-a",
      now: base,
      leaseMs: 1_000,
    });
    await claimStorageMutation({
      id: parent.mutation.id,
      leaseOwner: "parent-b",
      now: new Date(base.getTime() + 2_000),
    });
    await claimStorageMutation({
      id: stepMutation.mutation.id,
      leaseOwner: "step-b",
      now: new Date(base.getTime() + 2_000),
    });

    await expect(
      recordStorageMutationParentChild({
        parentId: parent.mutation.id,
        leaseOwner: "parent-a",
        leaseToken: firstParent!.leaseToken,
        ordinal: 0,
        childId: null,
        result: { status: "stale" },
      }),
    ).rejects.toBeInstanceOf(StorageMutationFenceError);
    await expect(
      markStorageMutationStepApplied({
        mutationId: stepMutation.mutation.id,
        stepId: stepMutation.mutation.steps[0]!.id,
        leaseOwner: "step-a",
        leaseToken: firstStep!.leaseToken,
      }),
    ).rejects.toBeInstanceOf(StorageMutationFenceError);

    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: parent.mutation.id },
        select: { resultJson: true },
      }),
    ).resolves.toMatchObject({ resultJson: { children: [] } });
    await expect(
      db.storageMutationStep.findUniqueOrThrow({
        where: { id: stepMutation.mutation.steps[0]!.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "pending" });
  });

  it("replays an identical idempotency key and rejects a changed request", async () => {
    const user = await createUser();
    const idempotencyKey = randomUUID();
    const first = await prepareStorageMutation({
      kind: "file_move",
      ownerUserId: user.id,
      idempotencyKey,
      requestHash: "hash-a",
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [],
    });
    const replay = await prepareStorageMutation({
      kind: "file_move",
      ownerUserId: user.id,
      idempotencyKey,
      requestHash: "hash-a",
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [],
    });
    expect(replay.replayed).toBe(true);
    expect(replay.mutation.id).toBe(first.mutation.id);
    await expect(
      prepareStorageMutation({
        kind: "file_move",
        ownerUserId: user.id,
        idempotencyKey,
        requestHash: "hash-b",
        intentJson: intent([]) as unknown as Prisma.InputJsonValue,
        steps: [],
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_IDEMPOTENCY_KEY_REUSED",
      status: 409,
    } satisfies Partial<StorageMutationConflictError>);
  });

  it("fails closed on a non-empty preexisting mkdir target", async () => {
    const user = await createUser();
    const targetKey = `files/${user.storageId}/collision`;
    const target = path.join(storageRoot(), ...targetKey.split("/"));
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, "orphan.bin"), "private");
    const prepared = await prepareStorageMutation({
      kind: "folder_create",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "mkdir",
          targetKey,
          expectedNodeType: "directory",
          treeManifestDigest: EMPTY_TREE_MANIFEST_DIGEST,
        },
      ],
    });

    await expect(execute(prepared.mutation)).rejects.toBeInstanceOf(
      StorageMutationAmbiguityError,
    );
    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
      }),
    ).resolves.toMatchObject({ status: "recovery_required" });
    await expect(
      db.storageMutationStep.findUniqueOrThrow({
        where: { id: prepared.mutation.steps[0]!.id },
        select: { attemptCount: true, lastError: true },
      }),
    ).resolves.toMatchObject({
      attemptCount: 1,
      lastError: expect.any(String),
    });
    await expect(
      db.storageMutationResource.count({
        where: { mutationId: prepared.mutation.id, releasedAt: null },
      }),
    ).resolves.toBe(1);
    await expect(
      (await import("node:fs/promises")).readFile(
        path.join(target, "orphan.bin"),
        "utf8",
      ),
    ).resolves.toBe("private");
  });

  it("preserves an unexpected member added to a captured trash tree", async () => {
    const user = await createUser();
    const sourceKey = `files/${user.storageId}/captured`;
    const targetKey = `.trash/${user.storageId}/folders/captured`;
    const source = path.join(storageRoot(), ...sourceKey.split("/"));
    await mkdir(source, { recursive: true });
    const knownBytes = Buffer.from("known");
    await writeFile(path.join(source, "known.bin"), knownBytes);
    const capturedDigest = calculateCapturedTreeManifestDigest([
      {
        kind: "file",
        relativeKey: "known.bin",
        sizeBytes: BigInt(knownBytes.length),
        checksum: createHash("sha256").update(knownBytes).digest("hex"),
      },
    ]);
    await writeFile(path.join(source, "unexpected.bin"), "private");
    const prepared = await prepareStorageMutation({
      kind: "folder_trash",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey,
          expectedNodeType: "directory",
          treeManifestDigest: capturedDigest,
        },
      ],
    });

    await expect(execute(prepared.mutation)).rejects.toBeInstanceOf(
      StorageMutationAmbiguityError,
    );
    await expect(
      (await import("node:fs/promises")).readFile(
        path.join(source, "unexpected.bin"),
        "utf8",
      ),
    ).resolves.toBe("private");
    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "recovery_required" });
  });

  it("preserves bytes added after trash when purge validates the stored manifest", async () => {
    const user = await createUser();
    const trashKey = `.trash/${user.storageId}/folders/retained`;
    const quarantineKey = `tmp/quarantine/${randomUUID()}/tree`;
    const trashPath = path.join(storageRoot(), ...trashKey.split("/"));
    await mkdir(trashPath, { recursive: true });
    const knownBytes = Buffer.from("known");
    await writeFile(path.join(trashPath, "known.bin"), knownBytes);
    const capturedDigest = calculateCapturedTreeManifestDigest([
      {
        kind: "file",
        relativeKey: "known.bin",
        sizeBytes: BigInt(knownBytes.length),
        checksum: createHash("sha256").update(knownBytes).digest("hex"),
      },
    ]);
    await writeFile(path.join(trashPath, "added-later.bin"), "private");
    const prepared = await prepareStorageMutation({
      kind: "folder_purge",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey: trashKey,
          targetKey: quarantineKey,
          expectedNodeType: "directory",
          treeManifestDigest: capturedDigest,
        },
        {
          action: "delete_tree",
          targetKey: quarantineKey,
          expectedNodeType: "directory",
          treeManifestDigest: capturedDigest,
        },
      ],
    });

    await expect(execute(prepared.mutation)).rejects.toBeInstanceOf(
      StorageMutationAmbiguityError,
    );
    await expect(
      (await import("node:fs/promises")).readFile(
        path.join(trashPath, "added-later.bin"),
        "utf8",
      ),
    ).resolves.toBe("private");
  });

  it("rolls forward after rename completed but step-state write was lost", async () => {
    const user = await createUser();
    const sourceKey = `files/${user.storageId}/source.bin`;
    const targetKey = `files/${user.storageId}/target.bin`;
    const source = path.join(storageRoot(), ...sourceKey.split("/"));
    const target = path.join(storageRoot(), ...targetKey.split("/"));
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "restart-safe");
    const checksum = createHash("sha256").update("restart-safe").digest("hex");
    const prepared = await prepareStorageMutation({
      kind: "file_rename",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: 12n,
          expectedChecksum: checksum,
        },
      ],
    });
    await rename(source, target);

    await execute(prepared.mutation);

    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  const fsyncIt = process.platform === "win32" ? it.skip : it;

  fsyncIt.each(executorBoundaryCases)(
    "recovers $family after interruption at $boundary ($phase)",
    async ({ family, boundary, phase }) => {
      const caseId = randomUUID();
      const fixture = await prepareBoundaryFixture(family);
      let interrupted = false;

      await expect(
        claimAndExecuteStorageMutation({
          mutationId: fixture.mutation.id,
          filesRoot: storageRoot(),
          leaseOwner: `boundary:${caseId}`,
          commitMetadata: (tx) =>
            applyStorageMutationIntentMetadata(tx, fixture.mutation.intentJson),
          executionHook: async (reached, step) => {
            const reachedPhase =
              step?.action === "rename"
                ? "forward"
                : step?.action === "delete_file"
                  ? "cleanup"
                  : null;
            if (
              !interrupted &&
              reached === boundary &&
              (phase === null || phase === reachedPhase)
            ) {
              interrupted = true;
              throw new StorageMutationAbruptInterruptionError(boundary);
            }
          },
        }),
      ).rejects.toThrow(`Abrupt interruption at ${boundary}.`);
      expect(interrupted).toBe(true);

      const interruptedMutation = await db.storageMutation.findUniqueOrThrow({
        where: { id: fixture.mutation.id },
        select: {
          status: true,
          leaseOwner: true,
          metadataCommittedAt: true,
          completedAt: true,
          recoveryRequiredAt: true,
          nextAttemptAt: true,
        },
      });
      if (boundary === "completed") {
        expect(interruptedMutation).toMatchObject({
          status: "succeeded",
          leaseOwner: null,
          metadataCommittedAt: expect.any(Date),
          completedAt: expect.any(Date),
          recoveryRequiredAt: null,
          nextAttemptAt: null,
        });
      } else if (boundary === "metadata_committed") {
        expect(interruptedMutation).toMatchObject({
          status: "metadata_committed",
          leaseOwner: `boundary:${caseId}`,
          metadataCommittedAt: expect.any(Date),
          completedAt: null,
          recoveryRequiredAt: null,
          nextAttemptAt: null,
        });
      } else if (
        boundary === "finalization_started" ||
        phase === "cleanup" ||
        boundary === "cleanup_steps_applied"
      ) {
        expect(interruptedMutation).toMatchObject({
          status: "finalizing",
          leaseOwner: `boundary:${caseId}`,
          metadataCommittedAt: expect.any(Date),
          completedAt: null,
          recoveryRequiredAt: null,
          nextAttemptAt: null,
        });
      } else {
        expect(interruptedMutation).toMatchObject({
          status: "running",
          leaseOwner: `boundary:${caseId}`,
          metadataCommittedAt: null,
          completedAt: null,
          recoveryRequiredAt: null,
          nextAttemptAt: null,
        });
      }
      await fixture.assertInterrupted();

      if (boundary !== "completed") {
        await forceMutationRecoveryNow(fixture.mutation.id);
        await recoverStorageMutations({
          storagePaths: storagePaths(),
          leaseOwner: `recovery:${caseId}`,
        });
      }

      await expect(
        db.storageMutation.findUniqueOrThrow({
          where: { id: fixture.mutation.id },
          select: { status: true, recoveryRequiredAt: true },
        }),
      ).resolves.toEqual({
        status: "succeeded",
        recoveryRequiredAt: null,
      });
      await expect(
        db.storageMutationStep.findMany({
          where: { mutationId: fixture.mutation.id },
          select: { status: true },
          orderBy: { ordinal: "asc" },
        }),
      ).resolves.toEqual(
        fixture.mutation.steps.map(() => ({ status: "applied" })),
      );
      await expect(
        db.storageMutationResource.findMany({
          where: { mutationId: fixture.mutation.id, releasedAt: null },
        }),
      ).resolves.toEqual([]);
      await fixture.assertRecovered();
    },
  );

  fsyncIt("recovers after an interrupted rename", async () => {
    const user = await createUser();
    const sourceKey = `files/${user.storageId}/executor-source.bin`;
    const targetKey = `files/${user.storageId}/executor-target.bin`;
    const source = path.join(storageRoot(), ...sourceKey.split("/"));
    const target = path.join(storageRoot(), ...targetKey.split("/"));
    const bytes = Buffer.from("executor-boundary");
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, bytes);
    const prepared = await prepareStorageMutation({
      kind: "file_move",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(bytes.length),
          expectedChecksum: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    });
    const claimed = await claimStorageMutation({
      id: prepared.mutation.id,
      leaseOwner: "faulted-executor",
    });

    await expect(
      applyStorageMutationSteps({
        mutation: claimed!,
        filesRoot: storageRoot(),
        leaseOwner: "faulted-executor",
        leaseToken: claimed!.leaseToken,
        phase: "forward",
        afterFilesystemStep: async () => {
          throw new Error("simulated process termination");
        },
      }),
    ).rejects.toThrow("simulated process termination");
    await expect(
      db.storageMutationStep.findUniqueOrThrow({
        where: { id: prepared.mutation.steps[0]!.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "pending" });
    await expect(
      (await import("node:fs/promises")).access(target),
    ).resolves.toBe(undefined);
    await db.storageMutation.update({
      where: { id: prepared.mutation.id },
      data: { leaseExpiresAt: new Date(0) },
    });

    await execute(prepared.mutation);
    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "succeeded" });
  });

  fsyncIt("recovers after child-process death following rename", async () => {
    const user = await createUser();
    const sourceKey = `files/${user.storageId}/child-source.bin`;
    const targetKey = `files/${user.storageId}/child-target.bin`;
    const source = path.join(storageRoot(), ...sourceKey.split("/"));
    const target = path.join(storageRoot(), ...targetKey.split("/"));
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, "killed-after-rename");
    const checksum = createHash("sha256")
      .update("killed-after-rename")
      .digest("hex");
    const prepared = await prepareStorageMutation({
      kind: "file_rename",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: 19n,
          expectedChecksum: checksum,
        },
      ],
    });
    const childScript = `
      import { claimAndExecuteStorageMutation } from "@staaash/db/storage-mutation-executor";
      const [mutationId, filesRoot] = process.argv.slice(1);
      await claimAndExecuteStorageMutation({
        mutationId,
        filesRoot,
        leaseOwner: \`kill-fixture:\${process.pid}\`,
        commitMetadata: async () => null,
        executionHook: async (boundary) => {
          if (boundary === "filesystem_step_applied") {
            process.kill(process.pid, "SIGKILL");
          }
        },
      });
    `;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        childScript,
        prepared.mutation.id,
        storageRoot(),
      ],
      {
        env: process.env,
        stdio: "ignore",
      },
    );
    const [exitCode, exitSignal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ];
    if (process.platform === "win32") {
      expect(
        exitSignal === "SIGKILL" ||
          (typeof exitCode === "number" && exitCode !== 0),
      ).toBe(true);
    } else {
      expect(exitCode).toBeNull();
      expect(exitSignal).toBe("SIGKILL");
    }

    await expect(
      db.storageMutationStep.findUniqueOrThrow({
        where: { id: prepared.mutation.steps[0]!.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "pending" });
    await expectStorageMissing(sourceKey);
    await expectStorageBytes(targetKey, Buffer.from("killed-after-rename"));
    const killedMutation = await db.storageMutation.findUniqueOrThrow({
      where: { id: prepared.mutation.id },
      select: {
        status: true,
        leaseOwner: true,
        metadataCommittedAt: true,
        completedAt: true,
      },
    });
    expect(killedMutation.status).toBe("running");
    expect(killedMutation.leaseOwner).toMatch(/^kill-fixture:\d+$/);
    expect(killedMutation.metadataCommittedAt).toBeNull();
    expect(killedMutation.completedAt).toBeNull();
    await forceMutationRecoveryNow(prepared.mutation.id);
    await recoverStorageMutations({
      storagePaths: storagePaths(),
      leaseOwner: "child-kill-recovery",
    });
    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
      }),
    ).resolves.toMatchObject({ status: "succeeded" });
  });

  it("preserves a preexisting wrong target when the rename source is missing", async () => {
    const user = await createUser();
    const sourceKey = `files/${user.storageId}/missing.bin`;
    const targetKey = `files/${user.storageId}/collision.bin`;
    const target = path.join(storageRoot(), ...targetKey.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "unrelated-private-bytes");
    const prepared = await prepareStorageMutation({
      kind: "file_rename",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: 8n,
          expectedChecksum: createHash("sha256")
            .update("expected")
            .digest("hex"),
        },
      ],
    });

    await expect(execute(prepared.mutation)).rejects.toBeInstanceOf(
      StorageMutationAmbiguityError,
    );
    await expect(
      (await import("node:fs/promises")).readFile(target, "utf8"),
    ).resolves.toBe("unrelated-private-bytes");
    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
      }),
    ).resolves.toMatchObject({ status: "recovery_required" });
  });

  it.each([
    { name: "both source and target exist", source: "file", target: "file" },
    { name: "both source and target are absent", source: null, target: null },
    {
      name: "the inferred target has the wrong node type",
      source: null,
      target: "directory",
    },
  ] as const)("fails closed when $name", async ({ source, target }) => {
    const user = await createUser();
    const sourceKey = `files/${user.storageId}/matrix-source.bin`;
    const targetKey = `files/${user.storageId}/matrix-target.bin`;
    const sourcePath = path.join(storageRoot(), ...sourceKey.split("/"));
    const targetPath = path.join(storageRoot(), ...targetKey.split("/"));
    const bytes = Buffer.from("matrix-bytes");
    await mkdir(path.dirname(sourcePath), { recursive: true });
    if (source === "file") await writeFile(sourcePath, bytes);
    if (target === "file") await writeFile(targetPath, bytes);
    if (target === "directory") await mkdir(targetPath);
    const prepared = await prepareStorageMutation({
      kind: "file_restore",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey,
          targetKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(bytes.length),
          expectedChecksum: createHash("sha256").update(bytes).digest("hex"),
        },
      ],
    });

    await expect(execute(prepared.mutation)).rejects.toBeInstanceOf(
      StorageMutationAmbiguityError,
    );
    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: prepared.mutation.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "recovery_required" });
  });

  it.skipIf(process.platform === "win32")(
    "retries without moving bytes when source permissions block validation",
    async () => {
      const user = await createUser();
      const sourceKey = `files/${user.storageId}/permission-source.bin`;
      const targetKey = `files/${user.storageId}/permission-target.bin`;
      const sourcePath = path.join(storageRoot(), ...sourceKey.split("/"));
      const targetPath = path.join(storageRoot(), ...targetKey.split("/"));
      const bytes = Buffer.from("permission-matrix");
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, bytes);
      const prepared = await prepareStorageMutation({
        kind: "upload_replace",
        ownerUserId: user.id,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        intentJson: intent([]) as unknown as Prisma.InputJsonValue,
        steps: [
          {
            action: "rename",
            sourceKey,
            targetKey,
            expectedNodeType: "file",
            expectedSizeBytes: BigInt(bytes.length),
            expectedChecksum: createHash("sha256").update(bytes).digest("hex"),
          },
        ],
      });
      await chmod(sourcePath, 0);
      try {
        await expect(execute(prepared.mutation)).rejects.toThrow();
        await expect(
          (await import("node:fs/promises")).access(targetPath),
        ).rejects.toThrow();
        await expect(
          db.storageMutation.findUniqueOrThrow({
            where: { id: prepared.mutation.id },
            select: { status: true },
          }),
        ).resolves.toEqual({ status: "retrying" });
      } finally {
        await chmod(sourcePath, 0o600);
      }
    },
  );

  it("atomically updates one thousand descendant rows", async () => {
    const user = await createUser();
    const folder = await db.folder.create({
      data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
    });
    const files = await Promise.all(
      Array.from({ length: 1_000 }, (_, index) =>
        db.file.create({
          data: {
            ownerUserId: user.id,
            folderId: folder.id,
            originalName: `${index}.bin`,
            storageKey: `files/${user.storageId}/${index}.bin`,
            mimeType: "application/octet-stream",
            sizeBytes: 1n,
          },
        }),
      ),
    );
    const deletedAt = "2030-07-20T12:00:00.000Z";
    const operations: StorageMetadataOperation[] = files.map((file) => ({
      action: "update",
      entityType: "file",
      entityId: file.id,
      preRevision: 0,
      data: { deletedAt },
    }));
    const prepared = await prepareStorageMutation({
      kind: "folder_trash",
      ownerUserId: user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intent(operations) as unknown as Prisma.InputJsonValue,
      steps: [],
      entities: files.map((file) => ({
        entityType: "file",
        entityId: file.id,
        preRevision: 0,
        postRevision: 1,
      })),
    });

    await execute(prepared.mutation);

    await expect(
      db.file.count({
        where: {
          ownerUserId: user.id,
          deletedAt: new Date(deletedAt),
          storageRevision: 1,
        },
      }),
    ).resolves.toBe(1_000);
  });

  it("propagates a recovery-required child to its parent and retains owner lock", async () => {
    const user = await createUser();
    const parentIntent = {
      version: 1,
      metadataOperations: [],
      destinationFolderId: "destination",
      items: [{ id: "file-1", kind: "file" }],
    };
    const parent = await prepareStorageMutationParent({
      kind: "batch_move",
      ownerUserId: user.id,
      idempotencyKey: `batch:${randomUUID()}`,
      requestHash: "parent-hash",
      intentJson: parentIntent,
    });
    const childPayload = {
      item: { id: "file-1", kind: "file" as const },
      destinationFolderId: "destination",
    };
    const child = await prepareStorageMutation({
      parentId: parent.mutation.id,
      kind: "file_move",
      ownerUserId: user.id,
      idempotencyKey: `${parent.mutation.idempotencyKey}:0`,
      requestHash: hashWorkerStorageRequest(
        buildStorageMutationChildRequestHashPayload({
          operation: "batch_move",
          ...childPayload,
        }),
      ),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      resourceKeys: [],
      steps: [],
    });
    await db.storageMutation.update({
      where: { id: child.mutation.id },
      data: {
        status: "recovery_required",
        recoveryRequiredAt: new Date(),
        lastError: "ambiguous child bytes",
      },
    });

    await recoverStorageMutations({
      storagePaths: storagePaths(),
      leaseOwner: `parent-recovery:${randomUUID()}`,
    });

    await expect(
      db.storageMutation.findUniqueOrThrow({
        where: { id: parent.mutation.id },
      }),
    ).resolves.toMatchObject({
      status: "recovery_required",
      lastError: expect.stringContaining(child.mutation.id),
    });
    await expect(
      db.storageMutationResource.count({
        where: { mutationId: parent.mutation.id, releasedAt: null },
      }),
    ).resolves.toBe(2);
  });

  it("records an already-succeeded batch child after a parent crash gap", async () => {
    const user = await createUser();
    const item = { id: "file-1", kind: "file" as const };
    const destinationFolderId = "destination";
    const parent = await prepareStorageMutationParent({
      kind: "batch_move",
      ownerUserId: user.id,
      idempotencyKey: `batch:${randomUUID()}`,
      requestHash: "parent-hash",
      intentJson: {
        version: 1,
        metadataOperations: [],
        destinationFolderId,
        items: [item],
      },
    });
    const child = await prepareStorageMutation({
      parentId: parent.mutation.id,
      kind: "file_move",
      ownerUserId: user.id,
      idempotencyKey: `${parent.mutation.idempotencyKey}:0`,
      requestHash: hashWorkerStorageRequest(
        buildStorageMutationChildRequestHashPayload({
          operation: "batch_move",
          item,
          destinationFolderId,
        }),
      ),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      resourceKeys: [],
      steps: [],
    });
    await db.storageMutation.update({
      where: { id: child.mutation.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        resultJson: { ...item, status: "moved" },
      },
    });

    await recoverStorageMutations({
      storagePaths: storagePaths(),
      leaseOwner: `parent-recovery:${randomUUID()}`,
    });

    const recovered = await db.storageMutation.findUniqueOrThrow({
      where: { id: parent.mutation.id },
    });
    expect(recovered.status).toBe("succeeded");
    expect(recovered.resultJson).toMatchObject({
      children: [
        {
          ordinal: 0,
          childId: child.mutation.id,
          result: { ...item, status: "moved" },
        },
      ],
    });
  });

  it("records an already-succeeded clear-trash child after a parent crash gap", async () => {
    const user = await createUser();
    const item = { id: "folder-1", kind: "folder" as const };
    const plannedItem = {
      ...item,
      deletedAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
      storageRevision: 1,
      trashEntryId: "trash-entry-1",
    };
    const parent = await prepareStorageMutationParent({
      kind: "clear_trash",
      ownerUserId: user.id,
      idempotencyKey: `clear:${randomUUID()}`,
      requestHash: "parent-hash",
      intentJson: {
        version: 1,
        metadataOperations: [],
        orderedItems: [plannedItem],
      },
    });
    const child = await prepareStorageMutation({
      parentId: parent.mutation.id,
      kind: "folder_purge",
      ownerUserId: user.id,
      idempotencyKey: `${parent.mutation.idempotencyKey}:0`,
      requestHash: hashWorkerStorageRequest(
        buildStorageMutationChildRequestHashPayload({
          operation: "clear_trash",
          item,
        }),
      ),
      intentJson: intent([]) as unknown as Prisma.InputJsonValue,
      initialResultJson: {
        ...item,
        status: "purged",
        deletedFolderCount: 3,
        deletedFileCount: 4,
      },
      resourceKeys: [],
      steps: [],
    });
    await db.storageMutation.update({
      where: { id: child.mutation.id },
      data: {
        status: "succeeded",
        completedAt: new Date(),
        resultJson: {
          ...item,
          status: "purged",
          deletedFolderCount: 3,
          deletedFileCount: 4,
        },
      },
    });

    await recoverStorageMutations({
      storagePaths: storagePaths(),
      leaseOwner: `parent-recovery:${randomUUID()}`,
    });

    const recovered = await db.storageMutation.findUniqueOrThrow({
      where: { id: parent.mutation.id },
    });
    expect(recovered.status).toBe("succeeded");
    expect(recovered.resultJson).toMatchObject({
      children: [
        {
          ordinal: 0,
          childId: child.mutation.id,
          result: {
            ...item,
            status: "purged",
            deletedFolderCount: 3,
            deletedFileCount: 4,
          },
        },
      ],
    });
  });
});
