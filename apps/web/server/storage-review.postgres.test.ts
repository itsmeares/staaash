import { createHash, randomUUID } from "node:crypto";
import {
  access,
  link,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { getPrisma, type Prisma } from "@staaash/db/client";
import {
  applyStorageMutationIntentMetadata,
  prepareStorageMutation,
  type RecoverableStorageMutationIntent,
  type StorageMetadataOperation,
} from "@staaash/db/storage-mutations";
import {
  calculateCapturedTreeManifestDigest,
  claimAndExecuteStorageMutation,
  type StorageMutationExecutionBoundary,
} from "@staaash/db/storage-mutation-executor";
import {
  applyStorageReviewChoice,
  executeReviewedStorageMutation,
  markRecoveredNoticeSeen,
  readRecoveredNotice,
  readStorageReview,
  refreshStorageReviewInspection,
  reviewStoppedStorageMutations,
} from "@staaash/db/storage-review";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from "vite-plus/test";

import { recoverStorageMutations } from "../../worker/src/handlers/storage-mutation-recovery.js";
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
const storagePath = (key: string) =>
  path.join(storageRoot(), ...key.split("/"));
const checksumOf = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const stop = { code: "STORAGE_RECOVERY_REQUIRED" };
const COPY_STAMP = String.raw`\(recovered, \d{4}-\d{2}-\d{2} \d{2}-\d{2}\)`;

const assertTestIsolation = () =>
  assertIsolatedPostgresTestTarget({
    databaseUrl: inject("postgresDatabaseUrl"),
    databaseName: inject("postgresDatabaseName"),
  });

const expectMissing = (key: string) =>
  expect(access(storagePath(key))).rejects.toMatchObject({ code: "ENOENT" });
const expectBytes = (key: string, bytes: Buffer) =>
  expect(readFile(storagePath(key))).resolves.toEqual(bytes);
const writeAt = async (key: string, bytes: Buffer) => {
  await mkdir(path.dirname(storagePath(key)), { recursive: true });
  await writeFile(storagePath(key), bytes);
};

const intent = (
  metadataOperations: StorageMetadataOperation[],
): RecoverableStorageMutationIntent => ({ version: 1, metadataOperations });

const statusOf = async (mutationId: string) =>
  (
    await db.storageMutation.findUniqueOrThrow({
      where: { id: mutationId },
      select: { status: true },
    })
  ).status;

const createDrive = async () => {
  const id = randomUUID();
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@review.test`,
      storageId: `storage-${id}`,
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const [source, destination] = await Promise.all(
    ["Source", "Destination"].map((name) =>
      db.folder.create({
        data: { ownerUserId: user.id, parentId: root.id, name },
      }),
    ),
  );
  await mkdir(storagePath(`files/${user.storageId}/Source`), {
    recursive: true,
  });
  await mkdir(storagePath(`files/${user.storageId}/Destination`), {
    recursive: true,
  });
  return {
    user,
    root,
    source: source!,
    destination: destination!,
    key: (relative: string) => `files/${user.storageId}/${relative}`,
  };
};

type Drive = Awaited<ReturnType<typeof createDrive>>;

const run = (
  mutationId: string,
  intentJson: unknown,
  executionHook?: (boundary: StorageMutationExecutionBoundary) => Promise<void>,
) =>
  claimAndExecuteStorageMutation({
    mutationId,
    filesRoot: storageRoot(),
    leaseOwner: `test:${randomUUID()}`,
    commitMetadata: (tx) => applyStorageMutationIntentMetadata(tx, intentJson),
    executionHook,
  });

/** Source/Tree/child.bin moving to Destination/Tree, stopped by `arrange`. */
const stopFolderMove = async (
  drive: Drive,
  arrange: (keys: { source: string; target: string }) => Promise<void>,
) => {
  const tree = await db.folder.create({
    data: {
      ownerUserId: drive.user.id,
      parentId: drive.source.id,
      name: "Tree",
    },
  });
  const bytes = Buffer.from(`tree-${tree.id}`);
  const checksum = checksumOf(bytes);
  const source = drive.key("Source/Tree");
  const target = drive.key("Destination/Tree");
  await writeAt(`${source}/child.bin`, bytes);
  const file = await db.file.create({
    data: {
      ownerUserId: drive.user.id,
      folderId: tree.id,
      originalName: "child.bin",
      storageKey: `${source}/child.bin`,
      mimeType: "application/octet-stream",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
    },
  });
  const intentJson = intent([
    {
      action: "update",
      entityType: "folder",
      entityId: tree.id,
      preRevision: 0,
      data: { parentId: drive.destination.id },
    },
    {
      action: "update",
      entityType: "file",
      entityId: file.id,
      preRevision: 0,
      data: { storageKey: `${target}/child.bin` },
    },
  ]);
  const { mutation } = await prepareStorageMutation({
    kind: "folder_move",
    ownerUserId: drive.user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: intentJson as unknown as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey: source,
        targetKey: target,
        expectedNodeType: "directory",
        treeManifestDigest: calculateCapturedTreeManifestDigest([
          {
            kind: "file",
            relativeKey: "child.bin",
            sizeBytes: BigInt(bytes.length),
            checksum,
          },
        ]),
      },
    ],
    entities: [
      {
        entityType: "folder",
        entityId: drive.destination.id,
        preRevision: 0,
        postRevision: 0,
        beforeJson: null,
        afterJson: null,
      },
      {
        entityType: "folder",
        entityId: tree.id,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { parentId: drive.source.id, name: "Tree" },
        afterJson: { parentId: drive.destination.id },
      },
      {
        entityType: "file",
        entityId: file.id,
        preRevision: 0,
        postRevision: 1,
        beforeJson: { storageKey: `${source}/child.bin` },
        afterJson: { storageKey: `${target}/child.bin` },
      },
    ],
  });
  await arrange({ source, target });
  await expect(run(mutation.id, intentJson)).rejects.toMatchObject(stop);
  return { mutationId: mutation.id, tree, file, bytes, source, target };
};

/** Source/move.bin moving to Destination/move.bin, stopped by `arrange`. */
const stopFileMove = async (
  drive: Drive,
  arrange: (keys: { source: string; target: string }) => Promise<void>,
) => {
  const bytes = Buffer.from(`file-${randomUUID()}`);
  const checksum = checksumOf(bytes);
  const source = drive.key("Source/move.bin");
  const target = drive.key("Destination/move.bin");
  await writeAt(source, bytes);
  const file = await db.file.create({
    data: {
      ownerUserId: drive.user.id,
      folderId: drive.source.id,
      originalName: "move.bin",
      storageKey: source,
      mimeType: "application/octet-stream",
      sizeBytes: BigInt(bytes.length),
      contentChecksum: checksum,
    },
  });
  const intentJson = intent([
    {
      action: "update",
      entityType: "file",
      entityId: file.id,
      preRevision: 0,
      data: { folderId: drive.destination.id, storageKey: target },
    },
  ]);
  const { mutation } = await prepareStorageMutation({
    kind: "file_move",
    ownerUserId: drive.user.id,
    idempotencyKey: randomUUID(),
    requestHash: randomUUID(),
    intentJson: intentJson as unknown as Prisma.InputJsonValue,
    steps: [
      {
        action: "rename",
        sourceKey: source,
        targetKey: target,
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
        beforeJson: { folderId: drive.source.id, storageKey: source },
        afterJson: { folderId: drive.destination.id, storageKey: target },
      },
    ],
  });
  await arrange({ source, target });
  await expect(run(mutation.id, intentJson)).rejects.toMatchObject(stop);
  return { mutationId: mutation.id, file, bytes, source, target };
};

const recoveredCopiesIn = (folderId: string) =>
  Promise.all([
    db.folder.findMany({
      where: { parentId: folderId, name: { contains: "(recovered, " } },
    }),
    db.file.findMany({
      where: { folderId, originalName: { contains: "(recovered, " } },
    }),
  ]).then(([folders, files]) => ({ folders, files }));

/** The owner opens the review page, then picks a choice. */
const choose = async (
  mutationId: string,
  choice: Parameters<typeof applyStorageReviewChoice>[0]["choice"],
  byUserId: string,
) => {
  const inspection = await refreshStorageReviewInspection({
    mutationId,
    filesRoot: storageRoot(),
  });
  const result = await applyStorageReviewChoice({
    mutationId,
    choice,
    seen: inspection?.seen ?? null,
    filesRoot: storageRoot(),
    byUserId,
  });
  if (result.outcome !== "resumed") return result;
  await executeReviewedStorageMutation({
    mutationId,
    filesRoot: storageRoot(),
    leaseOwner: `test:${randomUUID()}`,
  });
  return result;
};

const autoFix = async () => {
  await reviewStoppedStorageMutations({ filesRoot: storageRoot() });
  await recoverStorageMutations({ storagePaths: storagePaths() });
};

beforeAll(async () => {
  assertTestIsolation();
  await mkdir(storageRoot(), { recursive: true });
});

beforeEach(async () => {
  assertTestIsolation();
  await db.storageMutation.deleteMany();
  await db.user.deleteMany();
  for (const entry of await readdir(storageRoot())) {
    await rm(path.join(storageRoot(), entry), { recursive: true, force: true });
  }
});

afterAll(async () => {
  await db.$disconnect();
});

describe("storage review", () => {
  it("finishes a move by itself when only empty folders are left behind", async () => {
    const drive = await createDrive();
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await mkdir(storagePath(`${source}/empty/deeper`), { recursive: true });
    });

    await autoFix();

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expectMissing(stopped.source);
    await expectBytes(`${stopped.target}/child.bin`, stopped.bytes);
    await expect(
      db.folder.findUniqueOrThrow({ where: { id: stopped.tree.id } }),
    ).resolves.toMatchObject({ parentId: drive.destination.id });
    const review = await readStorageReview(stopped.mutationId);
    expect(review?.review.fixes).toEqual([
      expect.objectContaining({
        choice: "finish",
        automatic: true,
        kept: [],
        removedEmptyFolders: 1,
      }),
    ]);
    await expect(readRecoveredNotice(drive.user.id)).resolves.toEqual({
      ids: [stopped.mutationId],
      items: [],
    });
    await markRecoveredNoticeSeen(drive.user.id, [stopped.mutationId]);
    await expect(readRecoveredNotice(drive.user.id)).resolves.toBeNull();
  });

  it("keeps files left in the old place as a recovered copy", async () => {
    const drive = await createDrive();
    const extra = Buffer.from("written after the move started");
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeAt(`${source}/notes.txt`, extra);
    });
    // A kept copy may put the person over their limit; it is still their file.
    await db.user.update({
      where: { id: drive.user.id },
      data: { storageLimitBytes: 1n },
    });

    await autoFix();

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expectBytes(`${stopped.target}/child.bin`, stopped.bytes);
    const copies = await recoveredCopiesIn(drive.source.id);
    expect(copies.folders).toHaveLength(1);
    const copy = copies.folders[0]!;
    expect(copy.name).toMatch(new RegExp(`^Tree ${COPY_STAMP}$`));
    await expectMissing(stopped.source);
    await expectBytes(drive.key(`Source/${copy.name}/notes.txt`), extra);
    await expect(
      db.file.findFirstOrThrow({ where: { folderId: copy.id } }),
    ).resolves.toMatchObject({
      originalName: "notes.txt",
      storageKey: drive.key(`Source/${copy.name}/notes.txt`),
      sizeBytes: BigInt(extra.length),
      contentChecksum: checksumOf(extra),
    });
    await expect(readRecoveredNotice(drive.user.id)).resolves.toEqual({
      ids: [stopped.mutationId],
      items: [
        {
          id: copy.id,
          kind: "folder",
          name: copy.name,
          folderId: drive.source.id,
        },
      ],
    });
  });

  it("keeps an unknown file in the way as a copy and finishes the move", async () => {
    const drive = await createDrive();
    const unknown = Buffer.from("someone else's file");
    const stopped = await stopFileMove(drive, async ({ target }) => {
      await writeAt(target, unknown);
    });
    const looked = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });
    expect(looked?.choices.map((choice) => choice.id)).toEqual(["finish"]);

    await autoFix();

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expectMissing(stopped.source);
    await expectBytes(stopped.target, stopped.bytes);
    await expect(
      db.file.findUniqueOrThrow({ where: { id: stopped.file.id } }),
    ).resolves.toMatchObject({ storageKey: stopped.target });
    const { files } = await recoveredCopiesIn(drive.destination.id);
    expect(files).toHaveLength(1);
    expect(files[0]!.originalName).toMatch(
      new RegExp(`^move ${COPY_STAMP}\\.bin$`),
    );
    await expectBytes(files[0]!.storageKey, unknown);
  });

  it("keeps both copies when the owner finishes a move where neither copy matches", async () => {
    const drive = await createDrive();
    const newer = Buffer.from("changed at the new place");
    const older = Buffer.from("changed at the old place");
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(`${target}/child.bin`), newer);
      await writeAt(`${source}/child.bin`, older);
    });
    await reviewStoppedStorageMutations({ filesRoot: storageRoot() });
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");

    await expect(
      choose(stopped.mutationId, "finish", drive.user.id),
    ).resolves.toMatchObject({ outcome: "resumed" });

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expect(
      db.file.findUniqueOrThrow({ where: { id: stopped.file.id } }),
    ).resolves.toMatchObject({
      storageKey: `${stopped.target}/child.bin`,
      sizeBytes: BigInt(newer.length),
      contentChecksum: checksumOf(newer),
    });
    await expectBytes(`${stopped.target}/child.bin`, newer);
    const copy = (await recoveredCopiesIn(drive.source.id)).folders[0]!;
    await expectBytes(drive.key(`Source/${copy.name}/child.bin`), older);
    const review = await readStorageReview(stopped.mutationId);
    expect(review?.review.fixes.at(-1)).toMatchObject({
      choice: "finish",
      automatic: false,
      byUserId: drive.user.id,
    });
  });

  it("undoes a move, keeps the new copy, and ends the change as aborted", async () => {
    const drive = await createDrive();
    const newer = Buffer.from("changed at the new place");
    const older = Buffer.from("changed at the old place");
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(`${target}/child.bin`), newer);
      await writeAt(`${source}/child.bin`, older);
    });

    await expect(
      choose(stopped.mutationId, "undo", drive.user.id),
    ).resolves.toMatchObject({ outcome: "resumed" });

    expect(await statusOf(stopped.mutationId)).toBe("aborted");
    await expect(
      db.folder.findUniqueOrThrow({ where: { id: stopped.tree.id } }),
    ).resolves.toMatchObject({ parentId: drive.source.id });
    await expect(
      db.file.findUniqueOrThrow({ where: { id: stopped.file.id } }),
    ).resolves.toMatchObject({
      storageKey: `${stopped.source}/child.bin`,
      contentChecksum: checksumOf(older),
    });
    await expectBytes(`${stopped.source}/child.bin`, older);
    const copy = (await recoveredCopiesIn(drive.destination.id)).folders[0]!;
    expect(copy.name).toMatch(new RegExp(`^Tree ${COPY_STAMP}$`));
    await expectBytes(drive.key(`Destination/${copy.name}/child.bin`), newer);
  });

  it("keeps a file that changed after the move as it is now", async () => {
    const drive = await createDrive();
    const changed = Buffer.from("edited by hand on the server");
    const stopped = await stopFileMove(drive, async ({ source, target }) => {
      await mkdir(path.dirname(storagePath(target)), { recursive: true });
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(target), changed);
    });
    await reviewStoppedStorageMutations({ filesRoot: storageRoot() });
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");

    await choose(stopped.mutationId, "keep", drive.user.id);

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expect(
      db.file.findUniqueOrThrow({ where: { id: stopped.file.id } }),
    ).resolves.toMatchObject({
      folderId: drive.destination.id,
      storageKey: stopped.target,
      sizeBytes: BigInt(changed.length),
      contentChecksum: checksumOf(changed),
    });
  });

  it("removes a file that is in neither place only when the owner chooses it", async () => {
    const drive = await createDrive();
    const stopped = await stopFileMove(drive, async ({ source, target }) => {
      await rm(storagePath(source));
      await mkdir(path.dirname(storagePath(target)), { recursive: true });
    });
    await reviewStoppedStorageMutations({ filesRoot: storageRoot() });
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");
    const review = await readStorageReview(stopped.mutationId);
    expect(review?.review.inspection).toMatchObject({
      group: "no_copy",
      auto: null,
      choices: [{ id: "remove" }, { id: "retry" }],
    });

    await choose(stopped.mutationId, "remove", drive.user.id);

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expect(
      db.file.findUnique({ where: { id: stopped.file.id } }),
    ).resolves.toBeNull();
  });

  it("removes a lost folder with everything inside, and nothing else", async () => {
    const drive = await createDrive();
    let inner = "";
    const stopped = await stopFolderMove(drive, async ({ source }) => {
      const tree = await db.folder.findFirstOrThrow({
        where: { name: "Tree" },
      });
      inner = (
        await db.folder.create({
          data: {
            ownerUserId: drive.user.id,
            parentId: tree.id,
            name: "Inner",
          },
        })
      ).id;
      await rm(storagePath(source), { recursive: true });
    });

    await choose(stopped.mutationId, "remove", drive.user.id);

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expect(
      db.folder.count({ where: { id: { in: [stopped.tree.id, inner] } } }),
    ).resolves.toBe(0);
    await expect(
      db.file.findUnique({ where: { id: stopped.file.id } }),
    ).resolves.toBeNull();
    await expect(
      db.folder.findUniqueOrThrow({ where: { id: drive.destination.id } }),
    ).resolves.toMatchObject({ parentId: drive.root.id, deletedAt: null });
  });

  it("refuses a choice when the disk changed after the owner looked", async () => {
    const drive = await createDrive();
    const newer = Buffer.from("changed at the new place");
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(`${target}/child.bin`), newer);
      await writeAt(`${source}/child.bin`, Buffer.from("old place"));
    });
    const looked = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });
    await rm(storagePath(stopped.source), { recursive: true });

    await expect(
      applyStorageReviewChoice({
        mutationId: stopped.mutationId,
        choice: "finish",
        seen: looked?.seen ?? null,
        filesRoot: storageRoot(),
        byUserId: drive.user.id,
      }),
    ).resolves.toMatchObject({
      outcome: "changed",
      inspection: { group: "changed" },
    });
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");
    await expectBytes(`${stopped.target}/child.bin`, newer);
  });

  it("refuses a choice when a copy changed but the diagnosis did not", async () => {
    const drive = await createDrive();
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(`${target}/child.bin`), "new place");
      await writeAt(`${source}/child.bin`, Buffer.from("old place"));
    });
    const looked = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });
    await writeFile(
      storagePath(`${stopped.source}/child.bin`),
      "old place, edited again",
    );

    await expect(
      applyStorageReviewChoice({
        mutationId: stopped.mutationId,
        choice: "finish",
        seen: looked?.seen ?? null,
        filesRoot: storageRoot(),
        byUserId: drive.user.id,
      }),
    ).resolves.toMatchObject({
      outcome: "changed",
      inspection: { group: "two_copies" },
    });
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");
  });

  it("never touches a folder with a shortcut inside", async () => {
    const drive = await createDrive();
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await mkdir(storagePath(source));
      await symlink("/etc", storagePath(`${source}/link`));
    });

    await autoFix();

    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");
    const review = await readStorageReview(stopped.mutationId);
    expect(review?.review.inspection).toMatchObject({
      group: "unsafe",
      unsafeReason: "shortcut_inside",
      choices: [{ id: "retry" }],
    });
    expect(review?.review.fixes).toEqual([]);
  });

  it("finishes a fix after the process that started it stops", async () => {
    const drive = await createDrive();
    const extra = Buffer.from("left behind");
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeAt(`${source}/notes.txt`, extra);
    });
    const looked = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });
    await expect(
      applyStorageReviewChoice({
        mutationId: stopped.mutationId,
        choice: "finish",
        seen: looked?.seen ?? null,
        filesRoot: storageRoot(),
        byUserId: drive.user.id,
      }),
    ).resolves.toMatchObject({ outcome: "resumed" });
    expect(await statusOf(stopped.mutationId)).toBe("retrying");

    await recoverStorageMutations({ storagePaths: storagePaths() });

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expectBytes(`${stopped.target}/child.bin`, stopped.bytes);
  });

  it("keeps changed bytes a permanent delete would remove, and offers no Undo", async () => {
    const drive = await createDrive();
    const bytes = Buffer.from("in the trash");
    const changed = Buffer.from("changed in quarantine");
    const mutationId = randomUUID();
    const sourceKey = `.trash/${drive.user.storageId}/files/old.bin`;
    const quarantineKey = `tmp/quarantine/${mutationId}/blob`;
    await writeAt(sourceKey, bytes);
    const file = await db.file.create({
      data: {
        ownerUserId: drive.user.id,
        folderId: drive.root.id,
        originalName: "old.bin",
        storageKey: sourceKey,
        mimeType: "application/octet-stream",
        sizeBytes: BigInt(bytes.length),
        contentChecksum: checksumOf(bytes),
        deletedAt: new Date(),
      },
    });
    const intentJson = intent([
      {
        action: "delete",
        entityType: "file",
        entityId: file.id,
        preRevision: 0,
      },
    ]);
    const expected = {
      expectedNodeType: "file" as const,
      expectedSizeBytes: BigInt(bytes.length),
      expectedChecksum: checksumOf(bytes),
    };
    await prepareStorageMutation({
      id: mutationId,
      kind: "file_purge",
      ownerUserId: drive.user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intentJson as unknown as Prisma.InputJsonValue,
      steps: [
        { action: "rename", sourceKey, targetKey: quarantineKey, ...expected },
        { action: "delete_file", targetKey: quarantineKey, ...expected },
      ],
      entities: [
        {
          entityType: "file",
          entityId: file.id,
          preRevision: 0,
          postRevision: 1,
          beforeJson: { storageKey: sourceKey },
          afterJson: null,
        },
      ],
    });
    await expect(
      run(mutationId, intentJson, async (boundary) => {
        if (boundary === "finalization_started") {
          await writeFile(storagePath(quarantineKey), changed);
        }
      }),
    ).rejects.toMatchObject(stop);

    await refreshStorageReviewInspection({
      mutationId,
      filesRoot: storageRoot(),
    });
    const review = await readStorageReview(mutationId);
    expect(review?.review.inspection?.choices.map((c) => c.id)).not.toContain(
      "undo",
    );

    await autoFix();

    expect(await statusOf(mutationId)).toBe("succeeded");
    await expectMissing(quarantineKey);
    const { files } = await recoveredCopiesIn(drive.root.id);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ deletedAt: null });
    expect(files[0]!.originalName).toMatch(
      new RegExp(`^old ${COPY_STAMP}\\.bin$`),
    );
    await expectBytes(files[0]!.storageKey, changed);
  });

  it("refuses a choice made on an older check than the saved one", async () => {
    const drive = await createDrive();
    const stopped = await stopFolderMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(`${target}/child.bin`), "new place");
      await writeAt(`${source}/child.bin`, Buffer.from("old place"));
    });
    const looked = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });
    await writeFile(
      storagePath(`${stopped.source}/child.bin`),
      "old place, edited again",
    );
    // Someone else's page, or the worker, saves a newer check meanwhile.
    await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });

    await expect(
      applyStorageReviewChoice({
        mutationId: stopped.mutationId,
        choice: "finish",
        seen: looked?.seen ?? null,
        filesRoot: storageRoot(),
        byUserId: drive.user.id,
      }),
    ).resolves.toMatchObject({ outcome: "changed" });
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");
  });

  it("does not take two hard links for one rename that stopped", async () => {
    const drive = await createDrive();
    const stopped = await stopFileMove(drive, async ({ source, target }) => {
      await link(storagePath(source), storagePath(target));
    });

    const inspection = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });

    expect(inspection?.group).not.toBe("clear");
    expect(inspection?.auto).not.toBe("retry");
  });

  it("keeps the old one of two identical copies as a recovered copy", async () => {
    const drive = await createDrive();
    const stopped = await stopFileMove(drive, async ({ source, target }) => {
      await writeAt(target, await readFile(storagePath(source)));
    });

    await autoFix();

    expect(await statusOf(stopped.mutationId)).toBe("succeeded");
    await expectMissing(stopped.source);
    await expectBytes(stopped.target, stopped.bytes);
    const { files } = await recoveredCopiesIn(drive.source.id);
    expect(files).toHaveLength(1);
    await expectBytes(files[0]!.storageKey, stopped.bytes);
  });

  it("offers no Keep for a folder where the file was", async () => {
    const drive = await createDrive();
    const stopped = await stopFileMove(drive, async ({ source, target }) => {
      await rm(storagePath(source));
      await mkdir(storagePath(target));
    });

    const inspection = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });

    expect(inspection?.group).toBe("changed");
    expect(inspection?.choices.map((choice) => choice.id)).toEqual(["retry"]);
  });

  it("still ends an Undo as aborted after it stopped and was checked again", async () => {
    const drive = await createDrive();
    const edited = Buffer.from("edited after the move");
    const stopped = await stopFileMove(drive, async ({ source, target }) => {
      await rename(storagePath(source), storagePath(target));
      await writeFile(storagePath(target), edited);
    });
    const looked = await refreshStorageReviewInspection({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
    });
    await expect(
      applyStorageReviewChoice({
        mutationId: stopped.mutationId,
        choice: "undo",
        seen: looked?.seen ?? null,
        filesRoot: storageRoot(),
        byUserId: drive.user.id,
      }),
    ).resolves.toMatchObject({ outcome: "resumed" });
    await writeAt(stopped.source, Buffer.from("in the way of the undo"));
    await executeReviewedStorageMutation({
      mutationId: stopped.mutationId,
      filesRoot: storageRoot(),
      leaseOwner: `test:${randomUUID()}`,
    }).catch(() => null);
    expect(await statusOf(stopped.mutationId)).toBe("recovery_required");
    await rm(storagePath(stopped.source));

    await choose(stopped.mutationId, "retry", drive.user.id);

    expect(await statusOf(stopped.mutationId)).toBe("aborted");
    await expectBytes(stopped.source, edited);
  });

  it("never lets a preview publish finish without its file", async () => {
    const drive = await createDrive();
    const bytes = Buffer.from("preview");
    const mutationId = randomUUID();
    const tmpKey = `tmp/derivatives/${mutationId}.webp`;
    const storageKey = `derivatives/${drive.user.storageId}/thumb.webp`;
    await writeAt(tmpKey, bytes);
    const intentJson = intent([]);
    await prepareStorageMutation({
      id: mutationId,
      kind: "derivative_publish",
      ownerUserId: drive.user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intentJson as unknown as Prisma.InputJsonValue,
      steps: [
        {
          action: "rename",
          sourceKey: tmpKey,
          targetKey: storageKey,
          expectedNodeType: "file",
          expectedSizeBytes: BigInt(bytes.length),
          expectedChecksum: checksumOf(bytes),
        },
      ],
      entities: [],
    });
    await rm(storagePath(tmpKey));
    await expect(run(mutationId, intentJson)).rejects.toMatchObject(stop);

    await refreshStorageReviewInspection({
      mutationId,
      filesRoot: storageRoot(),
    });
    const review = await readStorageReview(mutationId);
    expect(review?.review.inspection?.group).toBe("no_copy");
    expect(review?.review.inspection?.choices.map((c) => c.id)).toEqual([
      "retry",
    ]);

    await autoFix();
    expect(await statusOf(mutationId)).toBe("recovery_required");
  });
});

describe("review steps", () => {
  const runSteps = async (
    drive: Drive,
    steps: Parameters<typeof prepareStorageMutation>[0]["steps"],
  ) => {
    const intentJson = intent([]);
    const { mutation } = await prepareStorageMutation({
      kind: "storage_review_keep",
      ownerUserId: drive.user.id,
      idempotencyKey: randomUUID(),
      requestHash: randomUUID(),
      intentJson: intentJson as unknown as Prisma.InputJsonValue,
      steps,
    });
    return run(mutation.id, intentJson);
  };

  const setAside = async (drive: Drive, bytes: Buffer) => {
    const source = drive.key("Source/left.bin");
    const target = drive.key("Source/left (recovered).bin");
    await writeAt(source, bytes);
    return {
      source,
      target,
      run: () =>
        runSteps(drive, [
          {
            action: "set_aside",
            sourceKey: source,
            targetKey: target,
            expectedNodeType: "file",
            expectedSizeBytes: BigInt(bytes.length),
            expectedChecksum: checksumOf(bytes),
          },
        ]),
    };
  };

  it("never replaces a file that appeared at the new name", async () => {
    const drive = await createDrive();
    const bytes = Buffer.from("left behind");
    const other = Buffer.from("appeared at the same name");
    const step = await setAside(drive, bytes);
    await writeAt(step.target, other);

    await expect(step.run()).rejects.toMatchObject(stop);

    await expectBytes(step.source, bytes);
    await expectBytes(step.target, other);
  });

  it("never takes a separate file with the same bytes for its own link", async () => {
    const drive = await createDrive();
    const bytes = Buffer.from("left behind");
    const step = await setAside(drive, bytes);
    await writeAt(step.target, bytes);

    await expect(step.run()).rejects.toMatchObject(stop);

    await expectBytes(step.source, bytes);
    await expectBytes(step.target, bytes);
  });

  it("finishes moving a file aside after a crash between link and unlink", async () => {
    const drive = await createDrive();
    const bytes = Buffer.from("left behind");
    const step = await setAside(drive, bytes);
    await link(storagePath(step.source), storagePath(step.target));

    await step.run();

    await expect(
      db.storageMutation.findFirstOrThrow({ select: { status: true } }),
    ).resolves.toEqual({ status: "succeeded" });
    await expectMissing(step.source);
    await expectBytes(step.target, bytes);
  });

  it("borrows locks only from a change that is still stopped", async () => {
    const drive = await createDrive();
    const stopped = await stopFileMove(drive, async ({ target }) => {
      await writeAt(target, Buffer.from("in the way"));
    });
    await db.storageMutation.update({
      where: { id: stopped.mutationId },
      data: { status: "retrying" },
    });

    await expect(
      prepareStorageMutation({
        kind: "storage_review_keep",
        ownerUserId: drive.user.id,
        idempotencyKey: randomUUID(),
        requestHash: randomUUID(),
        intentJson: intent([]) as unknown as Prisma.InputJsonValue,
        steps: [
          {
            action: "set_aside",
            sourceKey: stopped.target,
            targetKey: drive.key("Destination/move (recovered).bin"),
            expectedNodeType: "file",
          },
        ],
        sharedWithMutationId: stopped.mutationId,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_MUTATION_IN_PROGRESS" });
  });

  it("stops removing empty folders when one holds a file", async () => {
    const drive = await createDrive();
    const root = drive.key("Source/Leftover");
    const bytes = Buffer.from("not empty after all");
    await mkdir(storagePath(`${root}/a/b`), { recursive: true });
    await writeAt(`${root}/c/kept.txt`, bytes);

    await expect(
      runSteps(drive, [{ action: "remove_empty_tree", targetKey: root }]),
    ).rejects.toMatchObject(stop);

    await expectBytes(`${root}/c/kept.txt`, bytes);
  });
});
