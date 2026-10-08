import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { getPrisma } from "@staaash/db/client";
import { prepareStorageMutation } from "@staaash/db/storage-mutations";
import { getQueueBacklogSummary } from "@staaash/db/health";
import {
  runStorageTransaction,
  StorageAdmissionBusyError,
  StorageAdmissionCancelledError,
  StorageTransactionUnavailableError,
} from "@staaash/db/storage-transactions";
import { filesService } from "./files/service";
import { buildInstanceHealthSummary } from "./health";

const db = getPrisma();
const createOwner = async (limit: bigint | null = null) => {
  const owner = await db.user.create({
    data: {
      id: randomUUID(),
      email: `${randomUUID()}@admission.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
      storageLimitBytes: limit,
    },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  return { owner, folder };
};
const input = (ownerUserId: string, id = randomUUID()) => ({
  id,
  kind: "upload_create" as const,
  ownerUserId,
  idempotencyKey: id,
  requestHash: "probe",
  reservedBytes: 1n,
  intentJson: { version: 1, metadataOperations: [] },
  steps: [
    {
      action: "rename" as const,
      sourceKey: `tmp/${id}`,
      targetKey: `files/${id}`,
      expectedNodeType: "file" as const,
    },
  ],
  entities: [
    {
      entityType: "file" as const,
      entityId: randomUUID(),
      preRevision: -1,
      postRevision: 0,
    },
  ],
});
const rowCounts = async (id: string) =>
  Promise.all([
    db.storageMutation.count({ where: { id } }),
    db.storageMutationStep.count({ where: { mutationId: id } }),
    db.storageMutationEntity.count({ where: { mutationId: id } }),
    db.storageMutationResource.count({ where: { mutationId: id } }),
  ]);
const lockOwner = async (id: string) => {
  const lock = new Client({ connectionString: inject("postgresDatabaseUrl") });
  await lock.connect();
  await lock.query("BEGIN");
  await lock.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [id]);
  return async () => {
    await lock.query("ROLLBACK");
    await lock.end();
  };
};
const upload = (
  { owner, folder }: Awaited<ReturnType<typeof createOwner>>,
  key = randomUUID(),
  signal?: AbortSignal,
) =>
  filesService.uploadFiles({
    actorRole: "member",
    actorUserId: owner.id,
    folderId: folder.id,
    idempotencyKey: key,
    signal,
    items: [
      {
        clientKey: key,
        originalName: `${key}.txt`,
        conflictStrategy: "fail",
        file: new File(["original bytes"], `${key}.txt`, {
          type: "text/plain",
        }),
      },
    ],
  });

beforeAll(async () => {
  await db.instance.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      name: "Admission regression",
      storageProtocolVersion: 2,
    },
    update: { storageProtocolVersion: 2 },
  });
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
});

describe("readiness and operational history", () => {
  it.each([
    "media.derivative.generate",
    "staging.cleanup",
    "unknown.future.job",
  ])("keeps %s failure visible without removing traffic", async (kind) => {
    const job = await db.backgroundJob.create({
      data: {
        kind,
        status: "dead",
        payloadJson: {},
        attemptCount: 5,
        maxAttempts: 5,
      },
    });
    try {
      const queue = await getQueueBacklogSummary(inject("postgresDatabaseUrl"));
      const summary = buildInstanceHealthSummary({
        databaseStatus: "healthy",
        storageStatus: "healthy",
        worker: {
          status: "healthy",
          lastSeenAt: new Date().toISOString(),
          message: "test",
        },
        queue,
        reconciliation: {
          status: "healthy",
          runStatus: "succeeded",
          lastCompletedAt: null,
          missingOriginalCount: 0,
          orphanedStorageCount: 0,
          message: "test",
        },
        storageWarnings: {
          status: "healthy",
          freeBytes: 100n,
          totalBytes: 1000n,
          message: "test",
        },
        versionInfo: {
          currentVersion: "1.2.0",
          lastUpdateCheckAt: null,
          updateCheckStatus: null,
          updateCheckMessage: null,
          latestAvailableVersion: null,
        },
      });
      expect(summary).toMatchObject({
        ok: true,
        failures: [],
        operational: { status: "warning", incidents: ["DEAD_JOBS"] },
        queue: { status: "error", dead: 1, probeStatus: "healthy" },
      });
    } finally {
      await db.backgroundJob.delete({ where: { id: job.id } });
    }
  });
});

describe("storage admission on real PostgreSQL", () => {
  it("refuses a held quota row even for unlimited users without waiting for expiry", async () => {
    const { owner } = await createOwner();
    const release = await lockOwner(owner.id);
    const plan = input(owner.id);
    const start = Date.now();
    try {
      await expect(prepareStorageMutation(plan)).rejects.toBeInstanceOf(
        StorageAdmissionBusyError,
      );
      expect(Date.now() - start).toBeLessThan(1000);
      expect(await rowCounts(plan.id)).toEqual([0, 0, 0, 0]);
    } finally {
      await release();
    }
  });
  it("reuses one staged upload when the quota row becomes available", async () => {
    const fixture = await createOwner(100n);
    const release = await lockOwner(fixture.owner.id);
    let released = false;
    const timer = setTimeout(() => {
      released = true;
      void release();
    }, 350);
    try {
      const key = randomUUID();
      const result = await upload(fixture, key);
      expect(result.uploadedFiles).toHaveLength(1);
      const stored = await db.file.findUniqueOrThrow({
        where: { id: result.uploadedFiles[0].id },
      });
      expect(
        await readFile(
          path.join(inject("postgresStorageRoot"), stored.storageKey),
          "utf8",
        ),
      ).toBe("original bytes");
      expect(stored.contentChecksum).toBe(
        createHash("sha256").update("original bytes").digest("hex"),
      );
      expect(
        await db.storageMutation.count({
          where: { idempotencyKey: `${key}:0` },
        }),
      ).toBe(1);
      expect(
        await db.storageMutationResource.count({
          where: {
            releasedAt: null,
            mutation: { ownerUserId: fixture.owner.id },
          },
        }),
      ).toBe(0);
      const replay = await upload(fixture, key);
      expect(replay.uploadedFiles[0].id).toBe(stored.id);
    } finally {
      clearTimeout(timer);
      if (!released) await release();
    }
  }, 10000);
  it("returns typed busy on sustained contention and removes unowned staging", async () => {
    const fixture = await createOwner();
    const release = await lockOwner(fixture.owner.id);
    const start = Date.now();
    const tmp = path.join(inject("postgresStorageRoot"), "tmp");
    const before = await readdir(tmp, { recursive: true }).catch(() => []);
    try {
      await expect(upload(fixture)).rejects.toBeInstanceOf(
        StorageAdmissionBusyError,
      );
      expect(Date.now() - start).toBeLessThan(4500);
      expect(
        await db.file.count({ where: { ownerUserId: fixture.owner.id } }),
      ).toBe(0);
      expect(
        await db.storageMutation.count({
          where: { ownerUserId: fixture.owner.id },
        }),
      ).toBe(0);
      expect(await readdir(tmp, { recursive: true })).toEqual(before);
    } finally {
      await release();
    }
  }, 10000);
  it("cancels admission waiting without publishing a file", async () => {
    const fixture = await createOwner();
    const release = await lockOwner(fixture.owner.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 250);
    try {
      await expect(
        upload(fixture, randomUUID(), controller.signal),
      ).rejects.toBeInstanceOf(StorageAdmissionCancelledError);
      expect(
        await db.file.count({ where: { ownerUserId: fixture.owner.id } }),
      ).toBe(0);
      expect(
        await db.storageMutation.count({
          where: { ownerUserId: fixture.owner.id },
        }),
      ).toBe(0);
    } finally {
      clearTimeout(timer);
      await release();
    }
  });
  it("keeps quota atomic under a shared-account burst", async () => {
    const fixture = await createOwner(42n);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => upload(fixture)),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(3);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason.code).toBe("USER_STORAGE_QUOTA_EXCEEDED");
    expect(
      (
        await db.file.aggregate({
          where: { ownerUserId: fixture.owner.id },
          _sum: { sizeBytes: true },
        })
      )._sum.sizeBytes,
    ).toBe(42n);
    expect(
      await db.storageMutation.count({
        where: {
          ownerUserId: fixture.owner.id,
          status: { notIn: ["succeeded", "aborted"] },
        },
      }),
    ).toBe(0);
  }, 15000);
  it.each(["StorageMutation", "StorageMutationStep", "StorageMutationEntity"])(
    "aborts a delayed %s insert without foreign-key fallout",
    async (table) => {
      const { owner } = await createOwner();
      const plan = input(owner.id);
      await db.$executeRawUnsafe(
        "CREATE FUNCTION admission_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(5.5); RETURN NEW; END $$",
      );
      await db.$executeRawUnsafe(
        `CREATE TRIGGER admission_delay BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION admission_delay()`,
      );
      try {
        await expect(prepareStorageMutation(plan)).rejects.toBeInstanceOf(
          StorageTransactionUnavailableError,
        );
        expect(await rowCounts(plan.id)).toEqual([0, 0, 0, 0]);
      } finally {
        await db.$executeRawUnsafe(
          `DROP TRIGGER admission_delay ON "${table}"`,
        );
        await db.$executeRawUnsafe("DROP FUNCTION admission_delay()");
      }
    },
    10000,
  );
  it("rechecks transaction state between parent and children when the client expires first", async () => {
    const { owner } = await createOwner();
    const plan = input(owner.id);
    await db.$executeRawUnsafe(
      "CREATE FUNCTION admission_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$",
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER admission_delay BEFORE INSERT ON "StorageMutation" FOR EACH ROW EXECUTE FUNCTION admission_delay()',
    );
    const client = {
      $transaction: <T>(
        callback: (
          tx: import("@staaash/db/client").Prisma.TransactionClient,
        ) => Promise<T>,
      ) => db.$transaction(callback, { timeout: 200 }),
    };
    try {
      await expect(
        prepareStorageMutation(plan, { client }),
      ).rejects.toBeInstanceOf(StorageTransactionUnavailableError);
      expect(await rowCounts(plan.id)).toEqual([0, 0, 0, 0]);
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER admission_delay ON "StorageMutation"',
      );
      await db.$executeRawUnsafe("DROP FUNCTION admission_delay()");
    }
  }, 5000);
  it("bounds the entire transaction across multiple individually short queries", async () => {
    await expect(
      runStorageTransaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_sleep(0.6)::text`;
          await tx.$queryRaw`SELECT pg_sleep(0.6)::text`;
        },
        { deadline: Date.now() + 1200 },
      ),
    ).rejects.toBeInstanceOf(StorageTransactionUnavailableError);
    expect(await db.user.count()).toBeGreaterThan(0);
  }, 5000);
});
