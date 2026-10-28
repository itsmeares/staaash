import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPrisma } from "@staaash/db/client";
import { STORAGE_MUTATION_MAX_PRECOMMIT_ATTEMPTS } from "@staaash/db/storage-mutation-executor";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { prismaFilesRepository } from "./repository";
import { createFilesService } from "./service";
import { recoverStorageMutations } from "../../../worker/src/handlers/storage-mutation-recovery.js";
import { getStoragePath, getStorageRoot } from "../storage";

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
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@folders.test`,
      storageId: id,
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  return {
    user,
    root,
    actor: { actorUserId: id, actorRole: "member" as const },
  };
};

it("keeps every byte and separate trash entry through scoped folder changes in a large library", async () => {
  const { user, root, actor } = await createOwner();
  const unrelated = await db.folder.create({
    data: { ownerUserId: user.id, name: "Unrelated", parentId: root.id },
  });
  await db.$executeRaw`
    INSERT INTO "File" (id, "ownerUserId", "folderId", "originalName", "storageKey", "mimeType", "sizeBytes", "updatedAt")
    SELECT ${user.id} || '-' || n, ${user.id}, ${unrelated.id}, n || '.txt', ${`files/${user.id}/Unrelated/`} || n || '.txt', 'text/plain', 1, NOW()
    FROM generate_series(1, 100000) n
  `;
  const broadFolders = vi
    .spyOn(prismaFilesRepository, "listFoldersByOwner")
    .mockRejectedValue(new Error("Unrelated folders must not be loaded"));
  const broadFiles = vi
    .spyOn(prismaFilesRepository, "listFilesByOwner")
    .mockRejectedValue(new Error("Unrelated files must not be loaded"));
  try {
    const outer = (
      await service.createFolder({ ...actor, parentId: root.id, name: "Outer" })
    ).folder;
    const inner = (
      await service.createFolder({
        ...actor,
        parentId: outer.id,
        name: "Inner",
      })
    ).folder;
    const target = (
      await service.createFolder({
        ...actor,
        parentId: root.id,
        name: "Target",
      })
    ).folder;
    const bytes = Buffer.from("preserve these original bytes");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const files = Array.from({ length: 130 }, (_, index) => ({
      id: randomUUID(),
      ownerUserId: user.id,
      folderId: outer.id,
      originalName: `${index}.txt`,
      storageKey: `files/${user.id}/Outer/${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      contentChecksum: checksum,
    }));
    await db.file.createMany({ data: files });
    for (const file of files)
      await writeFile(getStoragePath(file.storageKey), bytes);
    const innerFile = await db.file.create({
      data: {
        ...files[0],
        id: randomUUID(),
        folderId: inner.id,
        storageKey: `files/${user.id}/Outer/Inner/0.txt`,
      },
    });
    await writeFile(getStoragePath(innerFile.storageKey), bytes);
    await service.trashFile({ ...actor, fileId: files[0].id });
    await service.trashFolder({ ...actor, folderId: inner.id });
    await service.renameFolder({
      ...actor,
      folderId: outer.id,
      name: "Renamed",
    });
    await service.moveFolder({
      ...actor,
      folderId: outer.id,
      destinationFolderId: target.id,
    });
    await service.trashFolder({ ...actor, folderId: outer.id });
    await service.restoreFolder({ ...actor, folderId: outer.id });
    expect(
      (await db.file.findUniqueOrThrow({ where: { id: files[0].id } }))
        .deletedAt,
    ).not.toBeNull();
    expect(
      (await db.folder.findUniqueOrThrow({ where: { id: inner.id } }))
        .deletedAt,
    ).not.toBeNull();
    await service.restoreFolder({ ...actor, folderId: inner.id });
    await service.restoreFile({ ...actor, fileId: files[0].id });
    const restored = await db.file.findMany({
      where: { id: { in: [...files.map(({ id }) => id), innerFile.id] } },
    });
    expect(restored).toHaveLength(131);
    for (const file of restored) {
      expect(file.deletedAt).toBeNull();
      expect(
        file.storageKey.startsWith(`files/${user.id}/Target/Renamed/`),
      ).toBe(true);
      expect(await readFile(getStoragePath(file.storageKey))).toEqual(bytes);
      expect(file.contentChecksum).toBe(checksum);
    }
    expect(
      (await db.folder.findUniqueOrThrow({ where: { id: target.id } }))
        .treeSizeBytes,
    ).toBe(BigInt(131 * bytes.length));
    expect(await db.file.count({ where: { folderId: unrelated.id } })).toBe(
      100000,
    );
    await service.trashFolder({ ...actor, folderId: outer.id });
    const purge = await service.clearTrash(actor);
    expect(purge.deletedFileCount).toBe(131);
    expect(purge.deletedFolderCount).toBe(2);
    expect(await db.file.count({ where: { folderId: unrelated.id } })).toBe(
      100000,
    );
    const wide = (
      await service.createFolder({ ...actor, parentId: root.id, name: "Wide" })
    ).folder;
    const children = Array.from({ length: 1000 }, (_, index) => ({
      id: randomUUID(),
      ownerUserId: user.id,
      parentId: wide.id,
      name: `Empty ${index}`,
    }));
    await db.folder.createMany({ data: children });
    for (const child of children)
      await mkdir(getStoragePath(`files/${user.id}/Wide/${child.name}`));
    await service.trashFolder({ ...actor, folderId: wide.id });
    await service.restoreFolder({ ...actor, folderId: wide.id });
    await service.trashFolder({ ...actor, folderId: wide.id });
    const widePurge = await service.clearTrash(actor);
    expect(widePurge.deletedFolderCount).toBe(1001);
    expect(widePurge.deletedFileCount).toBe(0);
    expect(
      await db.folder.count({
        where: { id: { in: [wide.id, ...children.map(({ id }) => id)] } },
      }),
    ).toBe(0);
    expect(await db.file.count({ where: { folderId: unrelated.id } })).toBe(
      100000,
    );
    expect(broadFolders).not.toHaveBeenCalled();
    expect(broadFiles).not.toHaveBeenCalled();
  } finally {
    broadFolders.mockRestore();
    broadFiles.mockRestore();
    await db.file.deleteMany({ where: { ownerUserId: user.id } });
  }
}, 120000);

it("resolves only requested upload names and keeps missing-file and private-account boundaries", async () => {
  const { user, root, actor } = await createOwner();
  const other = await createOwner();
  const existing = (
    await service.createFolder({
      ...actor,
      parentId: root.id,
      name: "Existing",
    })
  ).folder;
  await db.file.createMany({
    data: [
      {
        ownerUserId: user.id,
        folderId: root.id,
        originalName: "Blocked",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
        storageStatus: "missing",
      },
      {
        ownerUserId: other.user.id,
        folderId: root.id,
        originalName: "Private",
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 1,
      },
    ],
  });
  const broadFolders = vi
    .spyOn(prismaFilesRepository, "listFoldersByOwner")
    .mockRejectedValue(new Error("Unrelated folders"));
  const broadFiles = vi
    .spyOn(prismaFilesRepository, "listFilesByOwner")
    .mockRejectedValue(new Error("Unrelated files"));
  try {
    const result = await service.ensureFolderPaths({
      ...actor,
      parentId: root.id,
      paths: ["Existing/Child", "Existing", "Private", "Existing/Child"],
    });
    expect(result.folders[1].folderId).toBe(existing.id);
    expect(result.folders[0].folderId).toBe(result.folders[3].folderId);
    expect(result.folders).toHaveLength(4);
    await expect(
      service.ensureFolderPaths({
        ...actor,
        parentId: root.id,
        paths: ["Blocked/Child"],
      }),
    ).rejects.toMatchObject({ code: "FOLDER_NAME_CONFLICT" });
    await expect(
      service.ensureFolderPaths({
        ...other.actor,
        parentId: root.id,
        paths: ["No access"],
      }),
    ).rejects.toMatchObject({ code: "FOLDER_NOT_FOUND" });
    const child = await db.folder.findUniqueOrThrow({
      where: { id: result.folders[0].folderId },
    });
    expect(child.parentId).toBe(existing.id);
    await expect(
      readFile(path.join(getStoragePath(`files/${user.id}`), "Blocked")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    broadFolders.mockRestore();
    broadFiles.mockRestore();
  }
});

it("keeps every byte in trash when request and worker recovery roll back a folder restore", async () => {
  const { user, root, actor } = await createOwner();
  const outer = (
    await service.createFolder({ ...actor, parentId: root.id, name: "Outer" })
  ).folder;
  const inner = (
    await service.createFolder({ ...actor, parentId: outer.id, name: "Inner" })
  ).folder;
  const bytes = Buffer.from("rollback keeps these bytes");
  const files = Array.from({ length: 130 }, (_, index) => ({
    id: randomUUID(),
    ownerUserId: user.id,
    folderId: index === 0 ? inner.id : outer.id,
    originalName: `${index}.txt`,
    storageKey: `files/${user.id}/Outer/${index === 0 ? "Inner/" : ""}${index}.txt`,
    mimeType: "text/plain",
    sizeBytes: bytes.length,
    contentChecksum: createHash("sha256").update(bytes).digest("hex"),
  }));
  await db.file.createMany({ data: files });
  for (const file of files)
    await writeFile(getStoragePath(file.storageKey), bytes);
  await service.trashFolder({ ...actor, folderId: outer.id });
  const fileIds = files.map(({ id }) => id);
  const trashedKeys = (
    await db.file.findMany({ where: { id: { in: fileIds } } })
  ).map(({ storageKey }) => storageKey);
  const expectStillTrashed = async () => {
    const current = await db.file.findMany({ where: { id: { in: fileIds } } });
    expect(current.map(({ storageKey }) => storageKey).sort()).toEqual(
      [...trashedKeys].sort(),
    );
    for (const file of current) {
      expect(file.deletedAt).not.toBeNull();
      expect(await readFile(getStoragePath(file.storageKey))).toEqual(bytes);
    }
    expect(
      (await db.folder.findUniqueOrThrow({ where: { id: outer.id } }))
        .deletedAt,
    ).not.toBeNull();
    await expect(
      readFile(getStoragePath(`files/${user.id}/Outer/1.txt`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
  };
  const latestRestore = () =>
    db.storageMutation.findFirstOrThrow({
      where: { ownerUserId: user.id, kind: "folder_restore" },
      orderBy: { createdAt: "desc" },
    });
  const suffix = user.id.replaceAll("-", "_");
  // Fail the metadata commit after the restore has moved bytes on disk.
  await db.$executeRawUnsafe(`
    CREATE FUNCTION fail_restore_${suffix}() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'forced restore failure'; END $$ LANGUAGE plpgsql
  `);
  await db.$executeRawUnsafe(`
    CREATE TRIGGER fail_restore_${suffix} BEFORE UPDATE ON "Folder"
    FOR EACH ROW WHEN (OLD.id = '${outer.id}' AND OLD."deletedAt" IS NOT NULL
      AND NEW."deletedAt" IS NULL)
    EXECUTE FUNCTION fail_restore_${suffix}()
  `);
  try {
    // The request itself rolls back once the attempt cap is reached.
    await db.$executeRawUnsafe(`
      CREATE FUNCTION last_attempt_${suffix}() RETURNS trigger AS $$
      BEGIN NEW."attemptCount" := ${STORAGE_MUTATION_MAX_PRECOMMIT_ATTEMPTS - 1};
      RETURN NEW; END $$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER last_attempt_${suffix} BEFORE INSERT ON "StorageMutation"
      FOR EACH ROW WHEN (NEW."ownerUserId" = '${user.id}')
      EXECUTE FUNCTION last_attempt_${suffix}()
    `);
    await expect(
      service.restoreFolder({ ...actor, folderId: outer.id }),
    ).rejects.toBeDefined();
    await db.$executeRawUnsafe(
      `DROP TRIGGER last_attempt_${suffix} ON "StorageMutation"`,
    );
    expect((await latestRestore()).status).toBe("aborted");
    await expectStillTrashed();

    // A transient request failure leaves the restore for worker recovery.
    await expect(
      service.restoreFolder({ ...actor, folderId: outer.id }),
    ).rejects.toBeDefined();
    const pending = await latestRestore();
    expect(pending.status).toBe("retrying");
    await db.storageMutation.update({
      where: { id: pending.id },
      data: {
        attemptCount: STORAGE_MUTATION_MAX_PRECOMMIT_ATTEMPTS - 1,
        leaseExpiresAt: new Date(0),
        nextAttemptAt: new Date(0),
      },
    });
    const storageRoot = getStorageRoot();
    await recoverStorageMutations({
      storagePaths: {
        filesRoot: storageRoot,
        tmpRoot: path.join(storageRoot, "tmp"),
        heartbeatPath: path.join(storageRoot, "tmp", "worker-heartbeat.json"),
        pendingDeleteRoot: path.join(storageRoot, "tmp", "pending-delete"),
        uploadStagingTtlMs: 1,
      },
    });
    expect((await latestRestore()).status).toBe("aborted");
    await expectStillTrashed();
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS last_attempt_${suffix} ON "StorageMutation"`,
    );
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS fail_restore_${suffix} ON "Folder"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS last_attempt_${suffix}, fail_restore_${suffix}`,
    );
  }

  await service.restoreFolder({ ...actor, folderId: outer.id });
  for (const file of files) {
    const restored = await db.file.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(restored).toMatchObject({
      deletedAt: null,
      storageKey: file.storageKey,
    });
    expect(await readFile(getStoragePath(file.storageKey))).toEqual(bytes);
  }
}, 60000);
