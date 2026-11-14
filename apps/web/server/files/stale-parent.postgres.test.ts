import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { beforeAll, expect, it, vi } from "vite-plus/test";

import { getStoragePath } from "../storage";
import { createFilesService } from "./service";

// Runs once, after a request planned its paths and before the journal admits it.
const beforeAdmission = vi.hoisted(() => ({
  kind: "",
  run: null as null | (() => Promise<unknown>),
}));
vi.mock("@/server/durable-storage-mutation", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/server/durable-storage-mutation")>();
  const runDurableStorageMutation: typeof original.runDurableStorageMutation =
    async (input) => {
      const { run } = beforeAdmission;
      if (input.kind === beforeAdmission.kind && run) {
        beforeAdmission.run = null;
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

const exists = (storageKey: string) =>
  stat(getStoragePath(storageKey)).then(
    () => true,
    () => false,
  );

/** Outer/Inner, with Outer renamed to Moved just before `kind` is admitted. */
const driveWithRenameBefore = async (kind: string) => {
  const id = randomUUID();
  const actor = { actorUserId: id, actorRole: "member" as const };
  await db.user.create({
    data: {
      id,
      email: `${id}@stale-parent.test`,
      storageId: id,
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  const outer = await service.createFolder({
    ...actor,
    parentId: root.id,
    name: "Outer",
  });
  const inner = await service.createFolder({
    ...actor,
    parentId: outer.folder.id,
    name: "Inner",
  });
  beforeAdmission.kind = kind;
  beforeAdmission.run = () =>
    service.renameFolder({
      ...actor,
      folderId: outer.folder.id,
      name: "Moved",
    });
  return { id, actor, innerId: inner.folder.id };
};

const upload = (
  drive: Awaited<ReturnType<typeof driveWithRenameBefore>>,
  name: string,
) =>
  service.uploadFiles({
    ...drive.actor,
    folderId: drive.innerId,
    idempotencyKey: randomUUID(),
    items: [
      {
        clientKey: randomUUID(),
        originalName: name,
        conflictStrategy: "fail",
        file: new File(["data"], name, { type: "text/plain" }),
      },
    ],
  });

it(
  "does not put an upload at the old path of a folder renamed since planning",
  {
    timeout: 30_000,
  },
  async () => {
    const drive = await driveWithRenameBefore("upload_create");

    await expect(upload(drive, "doc.txt")).rejects.toMatchObject({
      code: "STORAGE_ADMISSION_BUSY",
    });

    await expect(exists(`files/${drive.id}/Outer`)).resolves.toBe(false);
    await expect(
      db.file.count({ where: { ownerUserId: drive.id } }),
    ).resolves.toBe(0);
    await upload(drive, "doc.txt");
    await expect(exists(`files/${drive.id}/Moved/Inner/doc.txt`)).resolves.toBe(
      true,
    );
  },
);

it(
  "does not create a folder at the old path of a folder renamed since planning",
  {
    timeout: 30_000,
  },
  async () => {
    const drive = await driveWithRenameBefore("folder_create");
    const create = () =>
      service.createFolder({
        ...drive.actor,
        parentId: drive.innerId,
        name: "New",
      });

    await expect(create()).rejects.toMatchObject({
      code: "STORAGE_ADMISSION_BUSY",
    });

    await expect(exists(`files/${drive.id}/Outer`)).resolves.toBe(false);
    await create();
    await expect(exists(`files/${drive.id}/Moved/Inner/New`)).resolves.toBe(
      true,
    );
  },
);

/** A drive whose Inner folder holds doc.txt, with no rename armed yet. */
const driveWithFile = async () => {
  const drive = await driveWithRenameBefore("");
  const rename = beforeAdmission.run;
  beforeAdmission.run = null;
  await upload(drive, "doc.txt");
  const file = await db.file.findFirstOrThrow({
    where: { ownerUserId: drive.id },
  });
  const renameBefore = (kind: string) => {
    beforeAdmission.kind = kind;
    beforeAdmission.run = rename;
  };
  return { ...drive, fileId: file.id, renameBefore };
};

it(
  "does not restore a file to the old path of a folder renamed since planning",
  {
    timeout: 30_000,
  },
  async () => {
    const drive = await driveWithFile();
    const restore = () =>
      service.restoreFile({ ...drive.actor, fileId: drive.fileId });
    await service.trashFile({ ...drive.actor, fileId: drive.fileId });
    drive.renameBefore("file_restore");

    await expect(restore()).rejects.toMatchObject({
      code: "STORAGE_ADMISSION_BUSY",
    });

    await expect(exists(`files/${drive.id}/Outer`)).resolves.toBe(false);
    await restore();
    await expect(exists(`files/${drive.id}/Moved/Inner/doc.txt`)).resolves.toBe(
      true,
    );
  },
);

it(
  "does not restore a folder to the old path of a folder renamed since planning",
  {
    timeout: 30_000,
  },
  async () => {
    const drive = await driveWithFile();
    const restore = () =>
      service.restoreFolder({ ...drive.actor, folderId: drive.innerId });
    await service.trashFolder({ ...drive.actor, folderId: drive.innerId });
    drive.renameBefore("folder_restore");

    await expect(restore()).rejects.toMatchObject({
      code: "STORAGE_ADMISSION_BUSY",
    });

    await expect(exists(`files/${drive.id}/Outer`)).resolves.toBe(false);
    await restore();
    await expect(exists(`files/${drive.id}/Moved/Inner/doc.txt`)).resolves.toBe(
      true,
    );
  },
);

it(
  "keeps a folder readable while files upload into it at the same time",
  {
    timeout: 30_000,
  },
  async () => {
    const drive = await driveWithFile();

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        upload(drive, `side ${index}.txt`),
      ),
    );

    // A folder listed as an entity reads as busy until that mutation ends, so
    // uploads into one folder would block each other and the folder's own view.
    await expect(
      db.storageMutationEntity.count({
        where: {
          entityId: drive.innerId,
          mutation: { kind: "upload_create" },
        },
      }),
    ).resolves.toBe(0);
    await expect(
      db.file.count({
        where: { ownerUserId: drive.id, folderId: drive.innerId },
      }),
    ).resolves.toBe(9);
  },
);
