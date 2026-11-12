import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import {
  cancelBackgroundJob,
  dismissBackgroundJob,
  markBackgroundJobFailed,
  markBackgroundJobTerminal,
  recoverOrphanedDerivativeGenerations,
  retryBackgroundJob,
} from "@staaash/db/jobs";
import { buildDerivativeDedupeKey } from "@staaash/db/media-derivatives";

const old = new Date(Date.now() - 120_000);

async function generation(kind: "thumbnail" | "preview" = "thumbnail") {
  const db = getPrisma();
  const profile = kind === "thumbnail" ? "thumb-480" : "preview-1080p";
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@derivative.test`,
      storageId: randomUUID(),
      passwordHash: "fake",
    },
  });
  const file = await db.file.create({
    data: {
      ownerUserId: user.id,
      originalName: "photo.jpg",
      storageKey: `files/${user.storageId}/photo.jpg`,
      mimeType: "image/jpeg",
      sizeBytes: 10n,
    },
  });
  const job = await db.backgroundJob.create({
    data: {
      kind: "media.derivative.generate",
      status: "running",
      lockedBy: "fake-worker",
      attemptCount: 5,
      maxAttempts: 5,
      dedupeKey: buildDerivativeDedupeKey(file.id, kind, profile),
      payloadJson: { fileId: file.id, kind, profile },
    },
  });
  const derivative = await db.mediaDerivative.create({
    data: {
      fileId: file.id,
      kind,
      profile,
      status: "processing",
      generationJobId: job.id,
      updatedAt: old,
    },
  });
  const read = () =>
    db.mediaDerivative.findUniqueOrThrow({ where: { id: derivative.id } });
  return { db, user, file, job, derivative, read };
}

it.each(["terminal", "dead", "non-retryable"])(
  "settles an owned preview after %s failure",
  async (action) => {
    const { db, file, job, derivative, read } = await generation(
      action === "terminal" ? "thumbnail" : "preview",
    );
    const input = {
      jobId: job.id,
      workerId: "fake-worker",
      errorMessage: "Storage is busy",
    };
    if (action === "terminal") await markBackgroundJobTerminal(input);
    else
      await markBackgroundJobFailed({
        ...input,
        retryable: action !== "non-retryable",
      });
    expect(await read()).toMatchObject({
      status: "failed",
      error: "Storage is busy",
    });
    await db.mediaDerivative.update({
      where: { id: derivative.id },
      data: { updatedAt: old },
    });
    await recoverOrphanedDerivativeGenerations();
    expect(await read()).toMatchObject({
      status: "failed",
      error: "Storage is busy",
    });
    expect(
      await db.file.findUniqueOrThrow({ where: { id: file.id } }),
    ).toMatchObject({ storageKey: file.storageKey, sizeBytes: file.sizeBytes });
    await dismissBackgroundJob({ jobId: job.id, actorUserId: "fake-owner" });
    // Dismissal does not silently retry a genuine conversion failure.
    expect(await read()).toMatchObject({
      status: "failed",
      error: "Storage is busy",
    });
  },
);

it("rolls the job and history back if its preview cannot be settled", async () => {
  const { db, job, read } = await generation();
  await db.$executeRawUnsafe(
    `ALTER TABLE "MediaDerivative" ADD CONSTRAINT "test_derivative_failure" CHECK (status <> 'failed') NOT VALID`,
  );
  try {
    await expect(
      markBackgroundJobTerminal({
        jobId: job.id,
        workerId: "fake-worker",
        errorMessage: "Stopped",
      }),
    ).rejects.toThrow("test_derivative_failure");
    expect(
      await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: "running", lastError: null });
    expect(
      await db.backgroundJobEvent.count({ where: { jobId: job.id } }),
    ).toBe(0);
    expect(await read()).toMatchObject({ status: "processing" });
  } finally {
    await db.$executeRawUnsafe(
      `ALTER TABLE "MediaDerivative" DROP CONSTRAINT "test_derivative_failure"`,
    );
  }
});

it("leaves a scheduled retry available and settles only after its final failure", async () => {
  const { db, job, read } = await generation();
  await db.backgroundJob.update({
    where: { id: job.id },
    data: { attemptCount: 1 },
  });
  await markBackgroundJobFailed({
    jobId: job.id,
    workerId: "fake-worker",
    errorMessage: "Storage is busy",
  });
  expect(
    await db.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
  ).toMatchObject({ status: "queued" });
  expect(await read()).toMatchObject({ status: "processing" });
  await recoverOrphanedDerivativeGenerations();
  expect(await read()).toMatchObject({ status: "processing" });
});

it.each(["dismiss", "cancel"])(
  "clears an unfinished preview on %s without changing a ready one",
  async (action) => {
    const { db, job, derivative, read } = await generation();
    if (action === "dismiss")
      await db.backgroundJob.update({
        where: { id: job.id },
        data: { status: "dead" },
      });
    const run =
      action === "dismiss" ? dismissBackgroundJob : cancelBackgroundJob;
    await run({ jobId: job.id, actorUserId: "fake-owner" });
    expect(await read()).toMatchObject({ status: "stale", storageKey: null });
    await retryBackgroundJob({ jobId: job.id, actorUserId: "fake-owner" });
    await db.mediaDerivative.update({
      where: { id: derivative.id },
      data: {
        status: "ready",
        storageKey: `derivatives/${derivative.id}.jpg`,
        sizeBytes: 30n,
      },
    });
    if (action === "dismiss")
      await db.backgroundJob.update({
        where: { id: job.id },
        data: { status: "dead" },
      });
    await run({ jobId: job.id, actorUserId: "fake-owner" });
    expect(await read()).toMatchObject({
      status: "ready",
      storageKey: `derivatives/${derivative.id}.jpg`,
      sizeBytes: 30n,
    });
  },
);

it("does not settle another attempt's preview or let an old dismissal cancel a retry", async () => {
  const { db, job, derivative, read } = await generation();
  await db.mediaDerivative.update({
    where: { id: derivative.id },
    data: { generationJobId: "new-attempt" },
  });
  await markBackgroundJobTerminal({
    jobId: job.id,
    workerId: "fake-worker",
    errorMessage: "Old failure",
  });
  expect(await read()).toMatchObject({
    status: "processing",
    generationJobId: "new-attempt",
  });
  await retryBackgroundJob({ jobId: job.id, actorUserId: "fake-owner" });
  expect(
    await dismissBackgroundJob({ jobId: job.id, actorUserId: "fake-owner" }),
  ).toMatchObject({ actionApplied: false, status: "queued" });
  expect(await read()).toMatchObject({
    status: "processing",
    generationJobId: "new-attempt",
  });
});

it.each([
  "preparing",
  "prepared",
  "running",
  "retrying",
  "metadata_committed",
  "finalizing",
  "recovery_required",
])("preserves publication owned by a %s journal", async (status) => {
  const { db, user, job, derivative, read } = await generation();
  await db.storageMutation.create({
    data: {
      kind: "derivative_publish",
      ownerUserId: user.id,
      status,
      idempotencyKey: `derivative-publish:${job.id}`,
      intentJson: {},
      // Preparation can exist before its entity records do.
      entities:
        status === "preparing"
          ? undefined
          : {
              create: {
                entityType: "derivative",
                entityId: derivative.id,
                preRevision: 0,
                postRevision: 1,
              },
            },
    },
  });
  await markBackgroundJobTerminal({
    jobId: job.id,
    workerId: "fake-worker",
    errorMessage: "Publication interrupted",
  });
  expect(await read()).toMatchObject({ status: "processing" });
  await dismissBackgroundJob({ jobId: job.id, actorUserId: "fake-owner" });
  await recoverOrphanedDerivativeGenerations();
  expect(await read()).toMatchObject({ status: "processing" });
});

it.each([
  "failed",
  "dead",
  "cancelled",
  "succeeded",
  "missing",
  "unlinked",
] as const)("recovers an old orphan with a %s job", async (status) => {
  const { db, job, derivative, read } = await generation();
  if (status === "missing" || status === "unlinked")
    await db.backgroundJob.delete({ where: { id: job.id } });
  else
    await db.backgroundJob.update({
      where: { id: job.id },
      data: { status },
    });
  if (status === "unlinked")
    await db.mediaDerivative.update({
      where: { id: derivative.id },
      data: { generationJobId: null, status: "queued", updatedAt: old },
    });
  await recoverOrphanedDerivativeGenerations();
  expect(await read()).toMatchObject({
    status: "stale",
    storageKey: null,
    error: null,
  });
});

it.each(["queued", "running", "dedupe", "payload", "recent", "ready"])(
  "preserves a %s generation during recovery",
  async (state) => {
    const { db, job, derivative, read } = await generation();
    if (state === "queued")
      await db.backgroundJob.update({
        where: { id: job.id },
        data: { status: "queued", runAt: new Date(Date.now() + 60_000) },
      });
    if (state === "running")
      await db.backgroundJob.update({
        where: { id: job.id },
        data: { leaseExpiresAt: new Date(0) },
      });
    if (state === "dedupe" || state === "payload") {
      await db.mediaDerivative.update({
        where: { id: derivative.id },
        data: { generationJobId: null, updatedAt: old },
      });
      if (state === "payload")
        await db.backgroundJob.update({
          where: { id: job.id },
          data: { dedupeKey: null },
        });
    }
    if (state === "recent" || state === "ready") {
      await db.backgroundJob.update({
        where: { id: job.id },
        data: { status: "dead" },
      });
      await db.mediaDerivative.update({
        where: { id: derivative.id },
        data:
          state === "recent"
            ? { updatedAt: new Date() }
            : { status: "ready", updatedAt: old },
      });
    }
    await recoverOrphanedDerivativeGenerations();
    expect(await read()).toMatchObject({
      status: state === "ready" ? "ready" : "processing",
    });
  },
);

it("keeps an unlinked old row while a publication entity still owns it", async () => {
  const { db, user, job, derivative, read } = await generation();
  const mutation = await db.storageMutation.create({
    data: {
      kind: "derivative_publish",
      status: "recovery_required",
      ownerUserId: user.id,
      intentJson: {},
      entities: {
        create: {
          entityType: "derivative",
          entityId: derivative.id,
          preRevision: 0,
          postRevision: 1,
        },
      },
    },
  });
  await db.backgroundJob.delete({ where: { id: job.id } });
  await db.mediaDerivative.update({
    where: { id: derivative.id },
    data: { generationJobId: null, updatedAt: old },
  });
  await recoverOrphanedDerivativeGenerations();
  expect(await read()).toMatchObject({ status: "processing" });
  await db.storageMutation.update({
    where: { id: mutation.id },
    data: { status: "succeeded" },
  });
  await recoverOrphanedDerivativeGenerations();
  expect(await read()).toMatchObject({ status: "stale" });
});

it("rechecks a row changed by a newer attempt while recovery waits for its lock", async () => {
  const { db, job, derivative, read } = await generation();
  await db.backgroundJob.update({
    where: { id: job.id },
    data: { status: "dead" },
  });
  const newer = await db.backgroundJob.create({
    data: {
      kind: "media.derivative.generate",
      status: "running",
      payloadJson: {},
    },
  });
  let unlock!: () => void;
  let locked!: () => void;
  const held = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const released = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const writer = db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "MediaDerivative" WHERE id = ${derivative.id} FOR UPDATE`;
    locked();
    await released;
    await tx.mediaDerivative.update({
      where: { id: derivative.id },
      data: { generationJobId: newer.id, updatedAt: old },
    });
  });
  await held;
  const recovery = recoverOrphanedDerivativeGenerations();
  const running = recovery.then(() => undefined);
  try {
    await vi.waitFor(
      async () => {
        const [activity] = await db.$queryRaw<Array<{ waiting: boolean }>>`
        SELECT EXISTS (
          SELECT 1 FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
            AND query LIKE '%WITH orphan AS MATERIALIZED%'
        ) AS waiting
      `;
        expect(activity.waiting).toBe(true);
      },
      { timeout: 2000, interval: 20 },
    );
  } finally {
    unlock();
  }
  await writer;
  await running;
  expect(await read()).toMatchObject({
    status: "processing",
    generationJobId: newer.id,
  });
});
