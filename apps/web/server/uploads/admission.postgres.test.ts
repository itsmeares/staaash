import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  access,
  mkdir,
  open,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { UPLOAD_TERMINAL_RETENTION_MS } from "@staaash/db/upload-sessions";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FilesError } from "@/server/files/errors";
import { getStorageRoot, getTmpUploadPath } from "@/server/storage";
import { getUserStorageUsed, withUserQuotaWrite } from "@/server/user-storage";
import {
  reserveResumableSession,
  UploadAdmissionError,
} from "@/server/uploads/admission";
import {
  beginSessionCommit,
  cancelAndCleanupResumableSession,
  completeResumableSessionWithFile,
  createResumableSession,
  recordCompletedUploadChunk,
} from "@/server/uploads/session-service";
import { cleanupUploadSessionLifecycle } from "../../../worker/src/handlers/staging-cleanup.js";

const db = getPrisma();
const storageRoot = getStorageRoot();
const tmpRoot = path.join(storageRoot, "tmp");
const fixedNow = new Date("2030-07-20T12:00:00.000Z");
const futureExpiry = new Date(fixedNow.getTime() + 60 * 60 * 1000);

const storagePaths = {
  filesRoot: storageRoot,
  tmpRoot,
  heartbeatPath: path.join(tmpRoot, "worker-heartbeat.json"),
  pendingDeleteRoot: path.join(tmpRoot, "pending-delete"),
  uploadStagingTtlMs: 2 * 60 * 60 * 1000,
};

const createUser = async (storageLimitBytes: bigint | null = null) => {
  const id = randomUUID();
  return db.user.create({
    data: {
      id,
      email: `${id}@upl-01.test`,
      storageId: `storage-${id}`,
      passwordHash: "test-only",
      storageLimitBytes,
    },
  });
};

const setLimits = async ({
  maxUploadBytes = 1_000n,
  perUserSessions = 10,
  instanceSessions = 100,
  perUserBytes = 1_000n,
  instanceBytes = 10_000n,
}: {
  maxUploadBytes?: bigint;
  perUserSessions?: number;
  instanceSessions?: number;
  perUserBytes?: bigint;
  instanceBytes?: bigint;
} = {}) =>
  db.systemSettings.update({
    where: { id: "singleton" },
    data: {
      maxUploadBytes,
      resumableMaxActiveSessionsPerUser: perUserSessions,
      resumableMaxActiveSessionsInstance: instanceSessions,
      resumableMaxReservedBytesPerUser: perUserBytes,
      resumableMaxReservedBytesInstance: instanceBytes,
    },
  });

const reserve = async ({
  ownerUserId,
  sizeBytes,
  id = randomUUID(),
  expiresAt = futureExpiry,
}: {
  ownerUserId: string;
  sizeBytes: number;
  id?: string;
  expiresAt?: Date;
}) =>
  reserveResumableSession({
    id,
    ownerUserId,
    folderId: null,
    originalName: `${id}.bin`,
    mimeType: "application/octet-stream",
    totalSizeBytes: sizeBytes,
    expectedChecksum: null,
    protocolVersion: 2,
    chunkSizeBytes: Math.min(sizeBytes, 5),
    tmpPath: path.join(tmpRoot, `${id}.upload`),
    conflictStrategy: "safeRename",
    expiresAt,
  });

const expectOneAdmission = async (operations: Array<Promise<unknown>>) => {
  const results = await Promise.allSettled(operations);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  return results;
};

const expectAdmissionCode = async (
  operation: Promise<unknown>,
  code: UploadAdmissionError["code"],
) => {
  await expect(operation).rejects.toMatchObject({
    name: "UploadAdmissionError",
    code,
  });
};

const createTerminalSession = async ({
  ownerUserId,
  status = "failed",
  sizeBytes = 10,
  terminalAt = fixedNow,
  stagingReleasedAt = null,
  withChunk = false,
  withFile = false,
}: {
  ownerUserId: string;
  status?: "completed" | "failed" | "cancelled" | "expired";
  sizeBytes?: number;
  terminalAt?: Date;
  stagingReleasedAt?: Date | null;
  withChunk?: boolean;
  withFile?: boolean;
}) => {
  const id = randomUUID();
  const tmpPath = path.join(tmpRoot, `${id}.upload`);
  if (withFile) await writeFile(tmpPath, Buffer.alloc(sizeBytes, 1));
  await db.uploadSession.create({
    data: {
      id,
      ownerUserId,
      folderId: null,
      originalName: `${id}.bin`,
      mimeType: "application/octet-stream",
      totalSizeBytes: BigInt(sizeBytes),
      receivedBytes: withChunk ? BigInt(sizeBytes) : 0n,
      protocolVersion: 2,
      chunkSizeBytes: BigInt(sizeBytes),
      tmpPath,
      conflictStrategy: "safeRename",
      status,
      expiresAt: terminalAt,
      terminalAt,
      stagingReleasedAt,
      chunks: withChunk
        ? {
            create: {
              chunkIndex: 0,
              startByte: 0n,
              endByte: BigInt(sizeBytes - 1),
              sizeBytes: BigInt(sizeBytes),
            },
          }
        : undefined,
    },
  });
  return { id, tmpPath };
};

const runCleanup = (
  options: {
    now?: Date;
    removeStagingPath?: (targetPath: string) => Promise<void>;
    deleteTerminalRows?: (sessionIds: string[]) => Promise<unknown>;
  } = {},
) =>
  cleanupUploadSessionLifecycle({
    client: db as never,
    storagePaths,
    ...options,
  });

beforeAll(async () => {
  await mkdir(tmpRoot, { recursive: true });
});

beforeEach(async () => {
  await db.uploadChunk.deleteMany();
  await db.uploadSession.deleteMany();
  await db.file.deleteMany();
  await db.folder.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();
  await db.systemSettings.deleteMany();
  await db.systemSettings.create({
    data: {
      id: "singleton",
      maxUploadBytes: 1_000n,
      resumableMaxActiveSessionsPerUser: 10,
      resumableMaxActiveSessionsInstance: 100,
      resumableMaxReservedBytesPerUser: 1_000n,
      resumableMaxReservedBytesInstance: 10_000n,
    },
  });
  await rm(tmpRoot, { recursive: true, force: true });
  await mkdir(tmpRoot, { recursive: true });
});

afterAll(async () => {
  await db.$disconnect();
  await rm(storageRoot, { recursive: true, force: true });
});

describe("UPL-01 PostgreSQL admission control", () => {
  it("serializes the final per-user and instance session slots", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();

    await setLimits({ perUserSessions: 1, instanceSessions: 10 });
    await expectOneAdmission([
      reserve({ ownerUserId: firstUser.id, sizeBytes: 10 }),
      reserve({ ownerUserId: firstUser.id, sizeBytes: 10 }),
    ]);
    expect(
      await db.uploadSession.count({ where: { ownerUserId: firstUser.id } }),
    ).toBe(1);

    await db.uploadSession.deleteMany();
    await setLimits({ perUserSessions: 1, instanceSessions: 1 });
    await expectOneAdmission([
      reserve({ ownerUserId: firstUser.id, sizeBytes: 10 }),
      reserve({ ownerUserId: secondUser.id, sizeBytes: 10 }),
    ]);
    expect(await db.uploadSession.count()).toBe(1);
  });

  it("serializes the final per-user and instance staged-byte capacity", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();

    await setLimits({
      maxUploadBytes: 100n,
      perUserBytes: 100n,
      instanceBytes: 1_000n,
    });
    await expectOneAdmission([
      reserve({ ownerUserId: firstUser.id, sizeBytes: 60 }),
      reserve({ ownerUserId: firstUser.id, sizeBytes: 60 }),
    ]);
    expect(
      await db.uploadSession.aggregate({
        where: { ownerUserId: firstUser.id },
        _sum: { totalSizeBytes: true },
      }),
    ).toMatchObject({ _sum: { totalSizeBytes: 60n } });

    await db.uploadSession.deleteMany();
    await setLimits({
      maxUploadBytes: 100n,
      perUserBytes: 100n,
      instanceBytes: 100n,
    });
    await expectOneAdmission([
      reserve({ ownerUserId: firstUser.id, sizeBytes: 60 }),
      reserve({ ownerUserId: secondUser.id, sizeBytes: 60 }),
    ]);
    const total = await db.uploadSession.aggregate({
      _sum: { totalSizeBytes: true },
    });
    expect(total._sum.totalSizeBytes).toBe(60n);
  });

  it("admits exact boundaries and rejects the next byte or slot", async () => {
    const user = await createUser();
    await setLimits({
      maxUploadBytes: 100n,
      perUserSessions: 1,
      instanceSessions: 1,
      perUserBytes: 100n,
      instanceBytes: 100n,
    });

    await expect(
      reserve({ ownerUserId: user.id, sizeBytes: 100 }),
    ).resolves.toMatchObject({ totalSizeBytes: 100n });
    await expectAdmissionCode(
      reserve({ ownerUserId: user.id, sizeBytes: 1 }),
      "RESUMABLE_USER_SESSION_LIMIT_EXCEEDED",
    );

    await db.uploadSession.deleteMany();
    await expectAdmissionCode(
      reserve({ ownerUserId: user.id, sizeBytes: 101 }),
      "UPLOAD_SIZE_LIMIT_EXCEEDED",
    );
  });

  it("counts active reservations in quota and permits users without a quota", async () => {
    const limited = await createUser(100n);
    const unlimited = await createUser(null);
    await reserve({ ownerUserId: limited.id, sizeBytes: 60 });

    await expectAdmissionCode(
      reserve({ ownerUserId: limited.id, sizeBytes: 41 }),
      "USER_STORAGE_QUOTA_EXCEEDED",
    );
    await expect(
      reserve({ ownerUserId: unlimited.id, sizeBytes: 1_000 }),
    ).resolves.toBeDefined();

    const usage = await getUserStorageUsed(limited.id);
    expect(usage).toEqual({
      committedBytes: 0n,
      reservedBytes: 60n,
      usedBytes: 60n,
    });
  });

  it("serializes a resumable reservation against ordinary committed growth", async () => {
    const user = await createUser(100n);
    const fileId = randomUUID();
    const results = await expectOneAdmission([
      reserve({ ownerUserId: user.id, sizeBytes: 60 }),
      withUserQuotaWrite({
        ownerUserId: user.id,
        additionalBytes: 60n,
        callback: (tx) =>
          tx.file.create({
            data: {
              id: fileId,
              ownerUserId: user.id,
              folderId: null,
              originalName: "ordinary.bin",
              storageKey: `files/${user.storageId}/ordinary.bin`,
              mimeType: "application/octet-stream",
              sizeBytes: 60n,
            },
          }),
      }),
    ]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(
      rejected?.status === "rejected" &&
        (rejected.reason instanceof UploadAdmissionError ||
          rejected.reason instanceof FilesError),
    ).toBe(true);

    const usage = await getUserStorageUsed(user.id);
    expect(usage.usedBytes).toBe(60n);
  });

  it("keeps a failed filesystem allocation as a terminal DB-owned record", async () => {
    const user = await createUser();
    await expect(
      createResumableSession(
        {
          ownerUserId: user.id,
          folderId: null,
          originalName: "allocation.bin",
          mimeType: "application/octet-stream",
          totalSizeBytes: 10,
          expectedChecksum: null,
          conflictStrategy: "safeRename",
        },
        fixedNow,
        async () => {
          throw Object.assign(new Error("permission denied"), {
            code: "EACCES",
          });
        },
      ),
    ).rejects.toMatchObject({
      code: "UPLOAD_STORAGE_CAPACITY_UNAVAILABLE",
    });

    const session = await db.uploadSession.findFirstOrThrow();
    expect(session).toMatchObject({
      status: "failed",
      stagingReleasedAt: expect.any(Date),
      terminalAt: expect.any(Date),
    });
    await expect(access(session.tmpPath)).rejects.toBeDefined();
  });
});

describe("UPL-01 PostgreSQL lifecycle and cleanup", () => {
  it("recovers a crash-equivalent expired provisional reservation", async () => {
    const user = await createUser();
    const session = await reserve({
      ownerUserId: user.id,
      sizeBytes: 10,
      expiresAt: new Date(fixedNow.getTime() - 1),
    });

    await runCleanup({ now: fixedNow });

    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "expired",
      terminalAt: fixedNow,
      stagingReleasedAt: fixedNow,
    });
  });

  it("atomically transfers a committing reservation to committed usage", async () => {
    const user = await createUser(100n);
    const session = await createResumableSession(
      {
        ownerUserId: user.id,
        folderId: null,
        originalName: "complete.bin",
        mimeType: "application/octet-stream",
        totalSizeBytes: 10,
        expectedChecksum: null,
        conflictStrategy: "safeRename",
      },
      fixedNow,
    );
    await writeFile(session.tmpPath, Buffer.alloc(10, 1));
    await db.uploadSession.update({
      where: { id: session.id },
      data: { receivedBytes: 10n, status: "receiving" },
    });
    await beginSessionCommit({
      id: session.id,
      ownerUserId: user.id,
      expectedChecksum: null,
      now: fixedNow,
    });

    const fileId = randomUUID();
    const targetPath = path.join(storageRoot, "files", `${fileId}.bin`);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await rename(session.tmpPath, targetPath);
    await completeResumableSessionWithFile({
      id: session.id,
      ownerUserId: user.id,
      committedFileId: fileId,
      now: fixedNow,
      callback: (tx) =>
        tx.file.create({
          data: {
            id: fileId,
            ownerUserId: user.id,
            folderId: null,
            originalName: "complete.bin",
            storageKey: `files/${fileId}.bin`,
            mimeType: "application/octet-stream",
            sizeBytes: 10n,
          },
        }),
    });

    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "completed",
      committedFileId: fileId,
      terminalAt: fixedNow,
      stagingReleasedAt: fixedNow,
    });
    expect(await getUserStorageUsed(user.id)).toEqual({
      committedBytes: 10n,
      reservedBytes: 0n,
      usedBytes: 10n,
    });
  });

  it("cancels DB-first, removes chunks, and releases staging after absence", async () => {
    const user = await createUser();
    const session = await createResumableSession(
      {
        ownerUserId: user.id,
        folderId: null,
        originalName: "cancel.bin",
        mimeType: "application/octet-stream",
        totalSizeBytes: 10,
        expectedChecksum: null,
        conflictStrategy: "safeRename",
      },
      fixedNow,
    );
    await writeFile(session.tmpPath, Buffer.alloc(5, 1));
    await recordCompletedUploadChunk({
      sessionId: session.id,
      chunkIndex: 0,
      startByte: 0,
      endByte: 4,
      sizeBytes: 5,
    });

    await cancelAndCleanupResumableSession({
      id: session.id,
      ownerUserId: user.id,
      tmpPath: session.tmpPath,
    });

    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "cancelled",
      terminalAt: expect.any(Date),
      stagingReleasedAt: expect.any(Date),
    });
    expect(
      await db.uploadChunk.count({ where: { sessionId: session.id } }),
    ).toBe(0);
    await expect(access(session.tmpPath)).rejects.toBeDefined();
  });

  it("cleans terminal chunks/files, retains parents, then deletes after retention", async () => {
    const user = await createUser();
    const sessions = await Promise.all(
      (["completed", "failed", "cancelled", "expired"] as const).map((status) =>
        createTerminalSession({
          ownerUserId: user.id,
          status,
          withChunk: true,
          withFile: true,
        }),
      ),
    );

    await runCleanup({ now: fixedNow });
    expect(await db.uploadSession.count()).toBe(4);
    expect(await db.uploadChunk.count()).toBe(0);
    for (const session of sessions) {
      await expect(access(session.tmpPath)).rejects.toBeDefined();
    }
    expect(
      await db.uploadSession.count({ where: { stagingReleasedAt: fixedNow } }),
    ).toBe(4);

    await runCleanup({
      now: new Date(fixedNow.getTime() + UPLOAD_TERMINAL_RETENTION_MS + 1),
    });
    expect(await db.uploadSession.count()).toBe(0);
  });

  it("preserves a valid active session and it accepts the next chunk", async () => {
    const user = await createUser();
    const session = await createResumableSession(
      {
        ownerUserId: user.id,
        folderId: null,
        originalName: "active.bin",
        mimeType: "application/octet-stream",
        totalSizeBytes: 10,
        expectedChecksum: null,
        conflictStrategy: "safeRename",
        chunkSizeBytes: 5,
      },
      fixedNow,
    );
    await writeFile(session.tmpPath, Buffer.alloc(5, 1));
    await recordCompletedUploadChunk({
      sessionId: session.id,
      chunkIndex: 0,
      startByte: 0,
      endByte: 4,
      sizeBytes: 5,
    });
    const staleTime = new Date(
      fixedNow.getTime() - storagePaths.uploadStagingTtlMs - 1,
    );
    await utimes(session.tmpPath, staleTime, staleTime);

    await runCleanup({ now: fixedNow });
    await expect(access(session.tmpPath)).resolves.toBeUndefined();

    const handle = await open(session.tmpPath, "r+");
    await handle.write(Buffer.alloc(5, 2), 0, 5, 5);
    await handle.close();
    await expect(
      recordCompletedUploadChunk({
        sessionId: session.id,
        chunkIndex: 1,
        startByte: 5,
        endByte: 9,
        sizeBytes: 5,
      }),
    ).resolves.toBe(10);
  });

  it("retains failed staging liability, retries it, and stops at the byte boundary", async () => {
    const user = await createUser();
    const unrelatedUser = await createUser();
    await setLimits({
      maxUploadBytes: 100n,
      perUserBytes: 100n,
      instanceBytes: 1_000n,
    });
    const failed = await createTerminalSession({
      ownerUserId: user.id,
      sizeBytes: 60,
      terminalAt: new Date(
        fixedNow.getTime() - UPLOAD_TERMINAL_RETENTION_MS - 1,
      ),
      withFile: true,
    });

    const warnings = await runCleanup({
      now: fixedNow,
      removeStagingPath: async () => {
        throw new Error("simulated permission failure");
      },
    });
    expect(warnings).toHaveLength(1);
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: failed.id } }),
    ).toMatchObject({
      stagingReleasedAt: null,
      cleanupAttemptCount: 1,
      cleanupLastError: "simulated permission failure",
    });
    await expect(
      reserve({ ownerUserId: unrelatedUser.id, sizeBytes: 10 }),
    ).resolves.toBeDefined();

    await runCleanup({
      now: fixedNow,
      removeStagingPath: async () => {
        throw new Error("simulated permission failure");
      },
    });
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: failed.id } }),
    ).toMatchObject({
      stagingReleasedAt: null,
      cleanupAttemptCount: 2,
      cleanupLastError: "simulated permission failure",
    });

    await expect(
      reserve({ ownerUserId: user.id, sizeBytes: 40 }),
    ).resolves.toBeDefined();
    await expectAdmissionCode(
      reserve({ ownerUserId: user.id, sizeBytes: 1 }),
      "RESUMABLE_USER_RESERVED_BYTES_LIMIT_EXCEEDED",
    );

    await db.uploadSession.deleteMany({ where: { status: "allocating" } });
    await runCleanup({ now: fixedNow });
    expect(
      await db.uploadSession.findUnique({ where: { id: failed.id } }),
    ).toBeNull();
    await expect(access(failed.tmpPath)).rejects.toBeDefined();
  });

  it("does not block on one released overdue parent or transient DB deletion failure", async () => {
    const user = await createUser();
    const overdue = await createTerminalSession({
      ownerUserId: user.id,
      terminalAt: new Date(
        fixedNow.getTime() - UPLOAD_TERMINAL_RETENTION_MS - 1,
      ),
      stagingReleasedAt: fixedNow,
    });

    const warnings = await runCleanup({
      now: fixedNow,
      deleteTerminalRows: async () => {
        throw new Error("simulated database deletion failure");
      },
    });
    expect(warnings).toEqual([
      "terminal rows: simulated database deletion failure",
    ]);
    expect(
      await db.uploadSession.findUnique({ where: { id: overdue.id } }),
    ).not.toBeNull();
    await expect(
      reserve({ ownerUserId: user.id, sizeBytes: 10 }),
    ).resolves.toBeDefined();

    await db.uploadSession.deleteMany({ where: { status: "allocating" } });
    await runCleanup({ now: fixedNow });
    expect(
      await db.uploadSession.findUnique({ where: { id: overdue.id } }),
    ).toBeNull();
  });

  it("backpressures only at a systemic bounded backlog and resumes after recovery", async () => {
    const firstUser = await createUser();
    const secondUser = await createUser();
    await setLimits({
      maxUploadBytes: 100n,
      perUserSessions: 1,
      instanceSessions: 1,
      perUserBytes: 10_000n,
      instanceBytes: 10_000n,
    });
    const oldTerminalAt = new Date(
      fixedNow.getTime() - UPLOAD_TERMINAL_RETENTION_MS - 1,
    );

    for (let index = 0; index < 96; index += 1) {
      await createTerminalSession({
        ownerUserId: index % 2 === 0 ? firstUser.id : secondUser.id,
        terminalAt: oldTerminalAt,
        stagingReleasedAt: fixedNow,
        withChunk: true,
      });
    }

    await expectAdmissionCode(
      reserve({ ownerUserId: firstUser.id, sizeBytes: 1 }),
      "UPLOAD_INSTANCE_SESSION_BACKLOG_LIMIT_EXCEEDED",
    );
    expect(await db.uploadChunk.count()).toBe(96);

    await runCleanup({ now: fixedNow });
    expect(await db.uploadSession.count()).toBe(0);
    expect(await db.uploadChunk.count()).toBe(0);
    await expect(
      reserve({ ownerUserId: firstUser.id, sizeBytes: 1 }),
    ).resolves.toBeDefined();
  });

  it("grandfathers an admitted completion after limits and quota are reduced", async () => {
    const user = await createUser(100n);
    await setLimits({
      maxUploadBytes: 100n,
      perUserBytes: 100n,
      instanceBytes: 1_000n,
    });
    const session = await reserve({ ownerUserId: user.id, sizeBytes: 80 });
    await db.uploadSession.update({
      where: { id: session.id },
      data: { status: "created" },
    });
    await setLimits({
      maxUploadBytes: 50n,
      perUserBytes: 50n,
      instanceBytes: 1_000n,
    });
    await db.user.update({
      where: { id: user.id },
      data: { storageLimitBytes: 50n },
    });

    await beginSessionCommit({
      id: session.id,
      ownerUserId: user.id,
      expectedChecksum: null,
      now: fixedNow,
    });
    const fileId = randomUUID();
    await completeResumableSessionWithFile({
      id: session.id,
      ownerUserId: user.id,
      committedFileId: fileId,
      now: fixedNow,
      callback: (tx) =>
        tx.file.create({
          data: {
            id: fileId,
            ownerUserId: user.id,
            folderId: null,
            originalName: "grandfathered.bin",
            storageKey: `files/${fileId}.bin`,
            mimeType: "application/octet-stream",
            sizeBytes: 80n,
          },
        }),
    });
    expect(await getUserStorageUsed(user.id)).toMatchObject({
      committedBytes: 80n,
      reservedBytes: 0n,
    });
    await expectAdmissionCode(
      reserve({ ownerUserId: user.id, sizeBytes: 1 }),
      "USER_STORAGE_QUOTA_EXCEEDED",
    );
  });
});
