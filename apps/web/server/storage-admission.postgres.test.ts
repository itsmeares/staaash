import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  getPostgresPool,
  getPrisma,
  getStoragePrisma,
} from "@staaash/db/client";
import {
  prepareStorageMutation,
  claimStorageMutation,
  commitStorageMutationMetadata,
  StorageMutationConflictError,
} from "@staaash/db/storage-mutations";
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
  it("retries an expired uncommitted preparation without repeating bytes or quota", async () => {
    const fixture = await createOwner(14n);
    const key = randomUUID();
    const suffix = key.replaceAll("-", "");
    const sequence = `qa_prepare_timeout_${suffix}`;
    const fn = `qa_prepare_timeout_fn_${suffix}`;
    const trigger = `qa_prepare_timeout_trigger_${suffix}`;
    const fault = new Client({
      connectionString: inject("postgresDatabaseUrl"),
    });
    await fault.connect();
    try {
      await fault.query(`CREATE SEQUENCE ${sequence}`);
      await fault.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW."targetKey" LIKE '%${key}.txt' AND nextval('${sequence}') = 1 THEN
            PERFORM pg_sleep(6);
          END IF;
          RETURN NEW;
        END $$`);
      await fault.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON "StorageMutationStep"
        FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
      const result = await upload(fixture, key);
      expect(
        Number(
          (await fault.query(`SELECT last_value FROM ${sequence}`)).rows[0]
            .last_value,
        ),
      ).toBe(2);
      expect(result.uploadedFiles).toHaveLength(1);
      const file = await db.file.findUniqueOrThrow({
        where: { id: result.uploadedFiles[0].id },
      });
      expect(
        await readFile(
          path.join(inject("postgresStorageRoot"), file.storageKey),
          "utf8",
        ),
      ).toBe("original bytes");
      const journal = await db.storageMutation.findUniqueOrThrow({
        where: { idempotencyKey: `${key}:0` },
        include: { steps: true },
      });
      expect(journal).toMatchObject({
        status: "succeeded",
        attemptCount: 1,
        reservedBytes: null,
      });
      expect(journal.steps.map((step) => step.attemptCount)).toEqual([1]);
      expect(
        await db.file.count({ where: { ownerUserId: fixture.owner.id } }),
      ).toBe(1);
      const replay = await upload(fixture, key);
      expect(replay.uploadedFiles[0].id).toBe(file.id);
      expect(
        Number(
          (await fault.query(`SELECT last_value FROM ${sequence}`)).rows[0]
            .last_value,
        ),
      ).toBe(2);
    } finally {
      await fault.query(
        `DROP TRIGGER IF EXISTS ${trigger} ON "StorageMutationStep"`,
      );
      await fault.query(`DROP FUNCTION IF EXISTS ${fn}()`);
      await fault.query(`DROP SEQUENCE IF EXISTS ${sequence}`);
      await fault.end();
    }
  }, 15000);

  it("preserves exact sizes, step order and JSON nulls in batched journal writes", async () => {
    const { owner } = await createOwner();
    const original = input(owner.id);
    const plan = {
      ...original,
      steps: original.steps.map((step) => ({
        ...step,
        expectedSizeBytes: 9_007_199_254_740_993n,
      })),
    };
    plan.steps.push({
      ...plan.steps[0],
      sourceKey: `tmp/${randomUUID()}`,
      targetKey: `files/${randomUUID()}`,
    });
    const prepared = await prepareStorageMutation({
      ...plan,
      entities: [
        { ...plan.entities[0], beforeJson: null, afterJson: { path: "first" } },
        { ...plan.entities[0], entityId: randomUUID(), afterJson: null },
      ],
    });
    try {
      expect(
        prepared.mutation.steps.map((step) => ({
          ordinal: step.ordinal,
          bytes: step.expectedSizeBytes,
        })),
      ).toEqual([
        { ordinal: 0, bytes: 9_007_199_254_740_993n },
        { ordinal: 1, bytes: 9_007_199_254_740_993n },
      ]);
      const rows = await db.$queryRaw<
        Array<{ entityId: string; sqlNull: boolean; jsonNull: boolean }>
      >`
        SELECT "entityId", "beforeJson" IS NULL AS "sqlNull",
          COALESCE("beforeJson" = 'null'::jsonb, false) AS "jsonNull"
        FROM "StorageMutationEntity" WHERE "mutationId" = ${plan.id}
      `;
      expect(
        rows.find((row) => row.entityId === plan.entities[0].entityId),
      ).toMatchObject({ sqlNull: false, jsonNull: true });
      expect(
        rows.find((row) => row.entityId !== plan.entities[0].entityId),
      ).toMatchObject({ sqlNull: true, jsonNull: false });
    } finally {
      await db.storageMutation.delete({ where: { id: plan.id } });
    }
  });

  it("rolls back the parent and every child when a batched child write fails", async () => {
    const { owner } = await createOwner();
    const plan = input(owner.id);
    await expect(
      prepareStorageMutation({
        ...plan,
        entities: [plan.entities[0], plan.entities[0]],
      }),
    ).rejects.toBeInstanceOf(StorageMutationConflictError);
    expect(await rowCounts(plan.id)).toEqual([0, 0, 0, 0]);
  });

  it("does not run work refused by a full storage pool and recovers the connection", async () => {
    const storage = getStoragePrisma();
    let entered = 0;
    let markReady!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      markReady = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holders = Array.from({ length: 3 }, () =>
      storage.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1`;
        if (++entered === 3) markReady();
        await held;
      }),
    );
    let callbackRan = false;
    try {
      await ready;
      await expect(
        runStorageTransaction(
          async () => {
            callbackRan = true;
          },
          { deadline: Date.now() + 200 },
        ),
      ).rejects.toBeInstanceOf(StorageAdmissionBusyError);
      expect(callbackRan).toBe(false);
    } finally {
      release();
      await Promise.all(holders);
    }
    await expect(
      runStorageTransaction((tx) => tx.user.count()),
    ).resolves.toBeGreaterThanOrEqual(0);
  });

  it("admits storage work while page reads occupy every general connection", async () => {
    const pool = getPostgresPool();
    const occupied = [];
    try {
      for (let i = 0; i < (pool.options.max ?? 10); i++) {
        occupied.push(await pool.connect());
      }
      await expect(
        runStorageTransaction((tx) => tx.user.count()),
      ).resolves.toBeGreaterThanOrEqual(0);
    } finally {
      for (const connection of occupied) connection.release();
    }
  });
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
      expect(Date.now() - start).toBeLessThan(6500);
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
  it("gives admitted metadata work its own transaction budget", async () => {
    const { owner, folder } = await createOwner();
    const plan = { ...input(owner.id), steps: [], entities: [] };
    await prepareStorageMutation(plan);
    const claimed = await claimStorageMutation({
      id: plan.id,
      leaseOwner: "metadata-budget-test",
    });
    expect(claimed).not.toBeNull();

    const result = await commitStorageMutationMetadata({
      mutationId: plan.id,
      ownerUserId: owner.id,
      leaseOwner: claimed!.leaseOwner,
      leaseToken: claimed!.leaseToken,
      callback: async (tx) => {
        // Longer than the admission window, within the transaction work budget.
        await tx.$queryRaw`SELECT pg_sleep(3.2)::text`;
        return tx.folder.update({
          where: { id: folder.id },
          data: { name: "Renamed" },
        });
      },
      resultJson: (updated) => ({ folderId: updated.id }),
    });

    expect(result.name).toBe("Renamed");
    expect(
      await db.folder.findUnique({ where: { id: folder.id } }),
    ).toMatchObject({
      name: "Renamed",
    });
    expect(
      await db.storageMutation.findUnique({ where: { id: plan.id } }),
    ).toMatchObject({
      status: "metadata_committed",
      reservedBytes: null,
      resultJson: { folderId: folder.id },
    });
  }, 10000);
  it("bounds the entire transaction across multiple individually short queries", async () => {
    await expect(
      runStorageTransaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_sleep(2.6)::text`;
          await tx.$queryRaw`SELECT pg_sleep(2.6)::text`;
        },
        { deadline: Date.now() + 1200 },
      ),
    ).rejects.toBeInstanceOf(StorageTransactionUnavailableError);
    expect(await db.user.count()).toBeGreaterThan(0);
  }, 8000);
  it("lets admitted work finish after the waiting deadline", async () => {
    await expect(
      runStorageTransaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_sleep(1)::text`;
          return tx.user.count();
        },
        { deadline: Date.now() + 700 },
      ),
    ).resolves.toBeGreaterThan(0);
  }, 5000);
  it("classifies a session ending between statements before the client expires", async () => {
    const { folder } = await createOwner();
    // Separate the deadlines to reliably exercise pg's unqueryable-client guard.
    const client = {
      $transaction: <T>(
        callback: (
          tx: import("@staaash/db/client").Prisma.TransactionClient,
        ) => Promise<T>,
      ) => db.$transaction(callback, { timeout: 10000 }),
    };
    let dependentWriteReached = false;
    let failure: unknown;
    try {
      await runStorageTransaction(
        async (tx) => {
          await tx.folder.update({
            where: { id: folder.id },
            data: { name: "Uncommitted" },
          });
          await new Promise((resolve) => setTimeout(resolve, 5100));
          await tx.folder.update({
            where: { id: folder.id },
            data: { name: "Must not commit" },
          });
          dependentWriteReached = true;
        },
        { deadline: Date.now() + 1500, client },
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(StorageTransactionUnavailableError);
    expect((failure as Error).cause).toMatchObject({
      message: "Client has encountered a connection error and is not queryable",
    });
    expect(dependentWriteReached).toBe(false);
    expect(
      await db.folder.findUnique({ where: { id: folder.id } }),
    ).toMatchObject({
      name: "Files",
    });
    await expect(
      runStorageTransaction((tx) =>
        tx.folder.update({
          where: { id: folder.id },
          data: { name: "Next transaction works" },
        }),
      ),
    ).resolves.toMatchObject({ name: "Next transaction works" });
  }, 10000);
});
