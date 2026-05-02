import os from "node:os";
import path from "node:path";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackgroundJobRecord } from "@staaash/db/jobs";

const getPrismaMock = vi.fn();

vi.mock("@staaash/db/client", () => ({
  getPrisma: getPrismaMock,
}));

type TestFileRecord = {
  id: string;
  ownerUserId: string;
  folderId: string | null;
  storageKey: string;
  deletedAt: Date | null;
};

type TestFolderRecord = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  deletedAt: Date | null;
};

const fixedNow = new Date("2026-04-06T12:00:00.000Z");
const cutoffDate = new Date("2026-03-07T12:00:00.000Z");

const createJob = (): BackgroundJobRecord => ({
  id: "job-1",
  kind: "trash.retention",
  status: "queued",
  payloadJson: {},
  dedupeKey: null,
  runAt: fixedNow,
  lockedAt: null,
  lockedBy: null,
  attemptCount: 0,
  maxAttempts: 5,
  lastError: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
});

const createMockPrisma = ({
  files,
  folders,
  revalidateFolderById = new Map<string, TestFolderRecord | null>(),
}: {
  files: TestFileRecord[];
  folders: TestFolderRecord[];
  revalidateFolderById?: Map<string, TestFolderRecord | null>;
}) => {
  const client = {
    file: {
      findMany: vi.fn(async (args: object) => {
        const where = (args as { where?: Record<string, unknown> }).where ?? {};

        if (
          "deletedAt" in where &&
          typeof where.deletedAt === "object" &&
          where.deletedAt !== null &&
          "lte" in where.deletedAt
        ) {
          const cutoff = (where.deletedAt as { lte: Date }).lte;
          return files.filter(
            (file) => file.deletedAt !== null && file.deletedAt <= cutoff,
          );
        }

        if (
          "folderId" in where &&
          typeof where.folderId === "object" &&
          where.folderId !== null &&
          "in" in where.folderId
        ) {
          const folderIds = new Set((where.folderId as { in: string[] }).in);

          return files.filter(
            (file) => file.folderId !== null && folderIds.has(file.folderId),
          );
        }

        return [];
      }),
      findUnique: vi.fn(async (args: object) => {
        const id = ((args as { where?: { id?: string } }).where?.id ?? null) as
          | string
          | null;

        return files.find((file) => file.id === id) ?? null;
      }),
      deleteMany: vi.fn(async (args: object) => {
        const where = (args as { where?: Record<string, unknown> }).where ?? {};
        let deletedIds: string[] = [];

        if (typeof where.id === "string") {
          deletedIds = [where.id];
        } else if (
          typeof where.id === "object" &&
          where.id !== null &&
          "in" in where.id
        ) {
          deletedIds = (where.id as { in: string[] }).in;
        }

        const before = files.length;
        const deleteSet = new Set(deletedIds);
        const remaining = files.filter((file) => !deleteSet.has(file.id));
        files.splice(0, files.length, ...remaining);

        return { count: before - files.length };
      }),
    },
    folder: {
      findMany: vi.fn(async (args: object) => {
        const where = (args as { where?: Record<string, unknown> }).where ?? {};

        if (typeof where.ownerUserId === "string" && "parentId" in where) {
          return folders
            .filter(
              (folder) =>
                folder.ownerUserId === where.ownerUserId &&
                folder.parentId === where.parentId,
            )
            .map((folder) => ({ id: folder.id }));
        }

        if (
          "deletedAt" in where &&
          typeof where.deletedAt === "object" &&
          where.deletedAt !== null &&
          "lte" in where.deletedAt
        ) {
          const cutoff = (where.deletedAt as { lte: Date }).lte;
          return folders.filter(
            (folder) => folder.deletedAt !== null && folder.deletedAt <= cutoff,
          );
        }

        if (
          "id" in where &&
          typeof where.id === "object" &&
          where.id !== null &&
          "in" in where.id
        ) {
          const folderIds = new Set((where.id as { in: string[] }).in);
          return folders.filter((folder) => folderIds.has(folder.id));
        }

        return [];
      }),
      findUnique: vi.fn(async (args: object) => {
        const id = ((args as { where?: { id?: string } }).where?.id ?? null) as
          | string
          | null;
        const baseFolder = folders.find((folder) => folder.id === id) ?? null;

        if (id && revalidateFolderById.has(id)) {
          return revalidateFolderById.get(id) ?? null;
        }

        return baseFolder;
      }),
      deleteMany: vi.fn(async (args: object) => {
        const folderIds = new Set(
          (((args as { where?: { id?: { in?: string[] } } }).where?.id ?? {})
            .in ?? []) as string[],
        );
        const before = folders.length;
        const remaining = folders.filter((folder) => !folderIds.has(folder.id));
        folders.splice(0, folders.length, ...remaining);

        return { count: before - folders.length };
      }),
    },
    $transaction: vi.fn(async (fn: (tx: typeof client) => Promise<unknown>) =>
      fn(client),
    ),
  };

  return client;
};

const createBlob = async (
  filesRoot: string,
  storageKey: string,
  content = "x",
) => {
  const filePath = path.resolve(filesRoot, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  return filePath;
};

describe("trash retention handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("deletes an expired trashed child tree when its parent is active", async () => {
    const filesRoot = await mkdtemp(
      path.join(os.tmpdir(), "staaash-trash-retention-"),
    );
    const folders: TestFolderRecord[] = [
      {
        id: "active-parent",
        ownerUserId: "member-1",
        parentId: null,
        deletedAt: null,
      },
      {
        id: "expired-child",
        ownerUserId: "member-1",
        parentId: "active-parent",
        deletedAt: cutoffDate,
      },
    ];
    const files: TestFileRecord[] = [
      {
        id: "file-1",
        ownerUserId: "member-1",
        folderId: "expired-child",
        storageKey: ".trash/member-1/expired-child/file.txt",
        deletedAt: cutoffDate,
      },
    ];
    const blobPath = await createBlob(filesRoot, files[0]!.storageKey, "child");
    getPrismaMock.mockReturnValue(createMockPrisma({ files, folders }));

    const { handleTrashRetention } = await import("./trash-retention.js");

    await handleTrashRetention(createJob(), {
      UPLOAD_LOCATION: filesRoot,
      TRASH_RETENTION_DAYS: "30",
    });

    await expect(access(blobPath)).rejects.toBeDefined();
    expect(files).toEqual([]);
    expect(folders.map((folder) => folder.id)).toEqual(["active-parent"]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("skips an expired child tree while its parent folder is still trashed", async () => {
    const filesRoot = await mkdtemp(
      path.join(os.tmpdir(), "staaash-trash-retention-"),
    );
    const folders: TestFolderRecord[] = [
      {
        id: "recent-parent",
        ownerUserId: "member-1",
        parentId: null,
        deletedAt: new Date("2026-03-20T12:00:00.000Z"),
      },
      {
        id: "expired-child",
        ownerUserId: "member-1",
        parentId: "recent-parent",
        deletedAt: cutoffDate,
      },
    ];
    const files: TestFileRecord[] = [
      {
        id: "file-1",
        ownerUserId: "member-1",
        folderId: "expired-child",
        storageKey: ".trash/member-1/recent-parent/expired-child/file.txt",
        deletedAt: cutoffDate,
      },
    ];
    const blobPath = await createBlob(filesRoot, files[0]!.storageKey, "child");
    getPrismaMock.mockReturnValue(createMockPrisma({ files, folders }));

    const { handleTrashRetention } = await import("./trash-retention.js");

    await handleTrashRetention(createJob(), {
      UPLOAD_LOCATION: filesRoot,
      TRASH_RETENTION_DAYS: "30",
    });

    await expect(access(blobPath)).resolves.toBeUndefined();
    expect(files.map((file) => file.id)).toEqual(["file-1"]);
    expect(folders.map((folder) => folder.id)).toEqual([
      "recent-parent",
      "expired-child",
    ]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("still deletes expired top-level trashed roots", async () => {
    const filesRoot = await mkdtemp(
      path.join(os.tmpdir(), "staaash-trash-retention-"),
    );
    const folders: TestFolderRecord[] = [
      {
        id: "expired-root",
        ownerUserId: "member-1",
        parentId: null,
        deletedAt: cutoffDate,
      },
    ];
    const files: TestFileRecord[] = [
      {
        id: "file-1",
        ownerUserId: "member-1",
        folderId: "expired-root",
        storageKey: ".trash/member-1/expired-root/file.txt",
        deletedAt: cutoffDate,
      },
    ];
    const blobPath = await createBlob(filesRoot, files[0]!.storageKey, "root");
    getPrismaMock.mockReturnValue(createMockPrisma({ files, folders }));

    const { handleTrashRetention } = await import("./trash-retention.js");

    await handleTrashRetention(createJob(), {
      UPLOAD_LOCATION: filesRoot,
      TRASH_RETENTION_DAYS: "30",
    });

    await expect(access(blobPath)).rejects.toBeDefined();
    expect(files).toEqual([]);
    expect(folders).toEqual([]);

    await rm(filesRoot, { recursive: true, force: true });
  });

  it("skips deletion when the trashed root is restored before transactional revalidation", async () => {
    const filesRoot = await mkdtemp(
      path.join(os.tmpdir(), "staaash-trash-retention-"),
    );
    const folders: TestFolderRecord[] = [
      {
        id: "expired-root",
        ownerUserId: "member-1",
        parentId: null,
        deletedAt: cutoffDate,
      },
    ];
    const files: TestFileRecord[] = [
      {
        id: "file-1",
        ownerUserId: "member-1",
        folderId: "expired-root",
        storageKey: ".trash/member-1/expired-root/file.txt",
        deletedAt: cutoffDate,
      },
    ];
    const blobPath = await createBlob(filesRoot, files[0]!.storageKey, "root");
    getPrismaMock.mockReturnValue(
      createMockPrisma({
        files,
        folders,
        revalidateFolderById: new Map([
          [
            "expired-root",
            {
              ...folders[0]!,
              deletedAt: null,
            },
          ],
        ]),
      }),
    );

    const { handleTrashRetention } = await import("./trash-retention.js");

    await handleTrashRetention(createJob(), {
      UPLOAD_LOCATION: filesRoot,
      TRASH_RETENTION_DAYS: "30",
    });

    await expect(access(blobPath)).resolves.toBeUndefined();
    expect(files.map((file) => file.id)).toEqual(["file-1"]);
    expect(folders.map((folder) => folder.id)).toEqual(["expired-root"]);

    await rm(filesRoot, { recursive: true, force: true });
  });
});
