import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { UPLOAD_TERMINAL_RETENTION_MS } from "@staaash/db/upload-sessions";
import { NextRequest } from "next/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  inject,
  it,
  vi,
} from "vitest";

import { PATCH as patchUpload } from "@/app/api/uploads/sessions/[id]/route";
import { getRequestSession } from "@/server/auth/guards";
import { FilesError, ResumableCompletionError } from "@/server/files/errors";
import {
  createPrismaFilesRepository,
  type FilesRepository,
} from "@/server/files/repository";
import { createFilesService } from "@/server/files/service";
import { buildFileStorageKey } from "@/server/files/storage-layout";
import { getStoragePath, getStorageRoot } from "@/server/storage";
import {
  type commitResumableUploadWithLock as commitResumableStorageUpload,
  ResumableStorageCommitError,
} from "@/server/storage-mutations";
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
import { assertIsolatedPostgresTestTarget } from "../../vitest.postgres.global";
import { cleanupUploadSessionLifecycle } from "../../../worker/src/handlers/staging-cleanup.js";

vi.mock("@/server/auth/guards", () => ({
  getRequestSession: vi.fn(),
}));

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

const assertTestIsolation = () => {
  const databaseName = inject("postgresDatabaseName");
  const databaseUrl = inject("postgresDatabaseUrl");
  expect(process.env.UPLOAD_LOCATION).toBe(inject("postgresStorageRoot"));
  assertIsolatedPostgresTestTarget({ databaseUrl, databaseName });
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

const filesRepo = createPrismaFilesRepository();

const getCommittedTarget = async ({
  ownerUserId,
  ownerStorageId,
  name,
}: {
  ownerUserId: string;
  ownerStorageId: string;
  name: string;
}) => {
  const filesRoot = await filesRepo.ensureFilesRoot(ownerUserId);
  const storageKey = buildFileStorageKey({
    file: {
      ownerStorageId,
      folderId: filesRoot.id,
      name,
    },
    folderMap: new Map([[filesRoot.id, filesRoot]]),
    filesRoot,
    trashed: false,
  });
  return { filesRoot, storageKey, targetPath: getStoragePath(storageKey) };
};

const createReadyToCommitSession = async ({
  ownerUserId,
  name,
  bytes = Buffer.from("0123456789"),
  conflictStrategy = "safeRename" as const,
}: {
  ownerUserId: string;
  name: string;
  bytes?: Buffer;
  conflictStrategy?: "safeRename" | "replace";
}) => {
  const session = await createResumableSession(
    {
      ownerUserId,
      folderId: null,
      originalName: name,
      mimeType: "application/octet-stream",
      totalSizeBytes: bytes.length,
      expectedChecksum: null,
      conflictStrategy,
      chunkSizeBytes: bytes.length,
    },
    fixedNow,
  );
  await writeFile(session.tmpPath, bytes);
  await recordCompletedUploadChunk({
    sessionId: session.id,
    chunkIndex: 0,
    startByte: 0,
    endByte: bytes.length - 1,
    sizeBytes: bytes.length,
  });
  await beginSessionCommit({
    id: session.id,
    ownerUserId,
    expectedChecksum: null,
    now: fixedNow,
  });
  return session;
};

const commitInput = ({
  ownerUserId,
  sessionId,
  tmpPath,
  name,
  totalSizeBytes,
  conflictStrategy = "safeRename" as const,
}: {
  ownerUserId: string;
  sessionId: string;
  tmpPath: string;
  name: string;
  totalSizeBytes: number;
  conflictStrategy?: "safeRename" | "replace";
}) => ({
  actorRole: "owner" as const,
  actorUserId: ownerUserId,
  uploadSessionId: sessionId,
  tmpPath,
  folderId: null,
  originalName: name,
  mimeType: "application/octet-stream",
  totalSizeBytes,
  contentChecksum: null,
  conflictStrategy,
});

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
  assertTestIsolation();
  await mkdir(tmpRoot, { recursive: true });
});

beforeEach(async () => {
  assertTestIsolation();
  vi.clearAllMocks();
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
});

describe("UPL-01 PostgreSQL admission control", () => {
  it("refuses a PostgreSQL target without a generated isolated database", () => {
    expect(() =>
      assertIsolatedPostgresTestTarget({
        databaseUrl: "postgresql://localhost/staaash",
        databaseName: "staaash",
      }),
    ).toThrow("Refusing non-generated PostgreSQL test database.");
    expect(() =>
      assertIsolatedPostgresTestTarget({
        databaseUrl: "postgresql://localhost/staaash",
        databaseName: "staaash_test_00000000000000000000000000000000",
      }),
    ).toThrow("PostgreSQL test URL is not bound to generated database.");
  });

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

  it("recovers a stale commit when the original staging file is present", async () => {
    const user = await createUser();
    const bytes = Buffer.from("recover-me");
    const session = await createReadyToCommitSession({
      ownerUserId: user.id,
      name: "recover.bin",
      bytes,
    });
    await db.uploadSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(fixedNow.getTime() - 1) },
    });

    const warnings = await runCleanup({ now: fixedNow });

    expect(warnings).toEqual([
      `${session.id}: Recovered stale committing session: original staging file is present.`,
    ]);
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "receiving",
      terminalAt: null,
      stagingReleasedAt: null,
      committedFileId: null,
      cleanupLastError:
        "Recovered stale committing session: original staging file is present.",
    });
    expect(await readFile(session.tmpPath)).toEqual(bytes);
    expect(
      await db.uploadChunk.count({ where: { sessionId: session.id } }),
    ).toBe(1);
  });

  it("retains ambiguous stale commits and their full capacity liability", async () => {
    const user = await createUser(10n);
    await setLimits({
      maxUploadBytes: 10n,
      perUserBytes: 10n,
      instanceBytes: 10n,
    });
    const session = await createReadyToCommitSession({
      ownerUserId: user.id,
      name: "ambiguous.bin",
    });
    const unknownTarget = path.join(storageRoot, "unknown", "ambiguous.bin");
    await mkdir(path.dirname(unknownTarget), { recursive: true });
    await rename(session.tmpPath, unknownTarget);
    await db.uploadSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(fixedNow.getTime() - 1) },
    });

    const warnings = await runCleanup({ now: fixedNow });
    expect(warnings).toEqual([
      `${session.id}: Commit outcome ambiguous: original staging path is missing.`,
    ]);
    const retained = await db.uploadSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(retained).toMatchObject({
      status: "committing",
      terminalAt: null,
      stagingReleasedAt: null,
      committedFileId: null,
      cleanupAttemptCount: 1,
      cleanupLastError:
        "Commit outcome ambiguous: original staging path is missing.",
    });
    expect(await getUserStorageUsed(user.id)).toMatchObject({
      reservedBytes: 10n,
      usedBytes: 10n,
    });
    await expectAdmissionCode(
      reserve({ ownerUserId: user.id, sizeBytes: 1 }),
      "RESUMABLE_USER_RESERVED_BYTES_LIMIT_EXCEEDED",
    );

    await runCleanup({
      now: new Date(fixedNow.getTime() + UPLOAD_TERMINAL_RETENTION_MS * 2),
    });
    expect(
      await db.uploadSession.findUnique({ where: { id: session.id } }),
    ).not.toBeNull();
    await expect(access(unknownTarget)).resolves.toBeUndefined();
  });

  it("rolls a transient new-file metadata failure back to staging and retries", async () => {
    const user = await createUser();
    const bytes = Buffer.from("new-upload");
    const name = "retry.bin";
    const session = await createReadyToCommitSession({
      ownerUserId: user.id,
      name,
      bytes,
    });
    const { targetPath } = await getCommittedTarget({
      ownerUserId: user.id,
      ownerStorageId: user.storageId,
      name,
    });
    let failMetadata = true;
    const flakyRepo: FilesRepository = {
      ...filesRepo,
      createFile: async (...args) => {
        if (failMetadata) {
          failMetadata = false;
          throw new Error("transient metadata failure");
        }
        return filesRepo.createFile(...args);
      },
    };
    const service = createFilesService({ repo: flakyRepo });
    const input = commitInput({
      ownerUserId: user.id,
      sessionId: session.id,
      tmpPath: session.tmpPath,
      name,
      totalSizeBytes: bytes.length,
    });

    await expect(service.commitResumableUpload(input)).rejects.toMatchObject({
      name: "ResumableCompletionError",
      code: "RESUMABLE_COMMIT_RETRYABLE",
    });
    expect(await readFile(session.tmpPath)).toEqual(bytes);
    await expect(access(targetPath)).rejects.toBeDefined();
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "receiving",
      stagingReleasedAt: null,
      committedFileId: null,
    });
    expect(
      await db.uploadChunk.count({ where: { sessionId: session.id } }),
    ).toBe(1);

    await beginSessionCommit({
      id: session.id,
      ownerUserId: user.id,
      expectedChecksum: null,
    });
    await expect(service.commitResumableUpload(input)).resolves.toMatchObject({
      name,
      sizeBytes: bytes.length,
    });
    expect(await readFile(targetPath)).toEqual(bytes);
    await expect(access(session.tmpPath)).rejects.toBeDefined();
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "completed",
      stagingReleasedAt: expect.any(Date),
      committedFileId: expect.any(String),
    });
    expect(
      await db.uploadChunk.count({ where: { sessionId: session.id } }),
    ).toBe(0);
  });

  it("keeps an ambiguous failed rollback committing and capacity reserved", async () => {
    const user = await createUser(10n);
    await setLimits({
      maxUploadBytes: 10n,
      perUserBytes: 10n,
      instanceBytes: 10n,
    });
    const bytes = Buffer.from("0123456789");
    const name = "unknown.bin";
    const session = await createReadyToCommitSession({
      ownerUserId: user.id,
      name,
      bytes,
    });
    const { targetPath } = await getCommittedTarget({
      ownerUserId: user.id,
      ownerStorageId: user.storageId,
      name,
    });
    const ambiguousCommit: typeof commitResumableStorageUpload = async ({
      stagedPath,
      targetPath: requestedTarget,
    }) => {
      await mkdir(path.dirname(requestedTarget), { recursive: true });
      await rename(stagedPath, requestedTarget);
      throw new ResumableStorageCommitError({
        outcome: "ambiguous",
        originalError: new Error("metadata unavailable"),
        rollbackError: new Error("rollback unavailable"),
      });
    };
    const service = createFilesService({
      repo: filesRepo,
      commitResumableStorageUpload: ambiguousCommit,
    });

    await expect(
      service.commitResumableUpload(
        commitInput({
          ownerUserId: user.id,
          sessionId: session.id,
          tmpPath: session.tmpPath,
          name,
          totalSizeBytes: bytes.length,
        }),
      ),
    ).rejects.toMatchObject({
      name: "ResumableCompletionError",
      code: "RESUMABLE_COMMIT_AMBIGUOUS",
    } satisfies Partial<ResumableCompletionError>);
    await expect(access(session.tmpPath)).rejects.toBeDefined();
    expect(await readFile(targetPath)).toEqual(bytes);
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "committing",
      stagingReleasedAt: null,
      committedFileId: null,
      cleanupLastError: expect.stringContaining("Commit ambiguous"),
    });
    expect(await getUserStorageUsed(user.id)).toMatchObject({
      reservedBytes: 10n,
    });
  });

  it("rolls resumable replacement back to staging and restores old content", async () => {
    const user = await createUser();
    const name = "replace.bin";
    const oldBytes = Buffer.from("old-content");
    const newBytes = Buffer.from("new-content");
    const { filesRoot, storageKey, targetPath } = await getCommittedTarget({
      ownerUserId: user.id,
      ownerStorageId: user.storageId,
      name,
    });
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, oldBytes);
    const existing = await filesRepo.createFile({
      ownerUserId: user.id,
      folderId: filesRoot.id,
      name,
      storageKey,
      mimeType: "application/octet-stream",
      sizeBytes: oldBytes.length,
      contentChecksum: null,
    });
    const session = await createReadyToCommitSession({
      ownerUserId: user.id,
      name,
      bytes: newBytes,
      conflictStrategy: "replace",
    });
    let failMetadata = true;
    const flakyRepo: FilesRepository = {
      ...filesRepo,
      updateFile: async (...args) => {
        if (failMetadata) {
          failMetadata = false;
          throw new Error("transient replacement metadata failure");
        }
        return filesRepo.updateFile(...args);
      },
    };
    const service = createFilesService({ repo: flakyRepo });

    await expect(
      service.commitResumableUpload(
        commitInput({
          ownerUserId: user.id,
          sessionId: session.id,
          tmpPath: session.tmpPath,
          name,
          totalSizeBytes: newBytes.length,
          conflictStrategy: "replace",
        }),
      ),
    ).rejects.toMatchObject({
      name: "ResumableCompletionError",
      code: "RESUMABLE_COMMIT_RETRYABLE",
    });
    expect(await readFile(session.tmpPath)).toEqual(newBytes);
    expect(await readFile(targetPath)).toEqual(oldBytes);
    expect(
      await db.file.findUniqueOrThrow({ where: { id: existing.id } }),
    ).toMatchObject({ sizeBytes: BigInt(oldBytes.length) });
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: session.id } }),
    ).toMatchObject({
      status: "receiving",
      stagingReleasedAt: null,
      committedFileId: null,
    });
    expect(
      await db.uploadChunk.count({ where: { sessionId: session.id } }),
    ).toBe(1);
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

    vi.mocked(getRequestSession).mockResolvedValue({
      user: { id: user.id, role: "owner" },
    } as Awaited<ReturnType<typeof getRequestSession>>);
    const request = new NextRequest(
      `http://localhost:3000/api/uploads/sessions/${session.id}`,
      {
        method: "PATCH",
        headers: {
          "content-length": "5",
          "content-range": "bytes 5-9/10",
          "content-type": "application/octet-stream",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
        body: Buffer.alloc(5, 2),
      },
    );
    const response = await patchUpload(request, {
      params: Promise.resolve({ id: session.id }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      receivedBytes: 10,
      chunkIndex: 1,
    });
    expect(await readFile(session.tmpPath)).toEqual(
      Buffer.concat([Buffer.alloc(5, 1), Buffer.alloc(5, 2)]),
    );
    expect(
      await db.uploadChunk.count({ where: { sessionId: session.id } }),
    ).toBe(2);
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
