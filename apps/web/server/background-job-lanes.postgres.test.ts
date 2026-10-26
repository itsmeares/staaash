import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import {
  claimDueBackgroundJob,
  registerWorkerInstance,
  renewBackgroundJobLease,
  markBackgroundJobSucceeded,
  cancelBackgroundJob,
  retryBackgroundJob,
} from "@staaash/db/jobs";

it("keeps archive lanes separate through competing claims, expiry and retry", async () => {
  const db = getPrisma();
  const queueName = randomUUID();
  const now = new Date();
  const ids = ["large", "small", "cleanup", "future"].map(() => randomUUID());
  const [large, small, cleanup, future] = ids;
  await db.backgroundJob.createMany({
    data: ids.map((id, i) => ({
      id,
      queueName,
      kind: i === 2 ? "zip.archive.cleanup" : "zip.archive.generate",
      priority: i === 0 ? 0 : 1,
      payloadJson: {},
      runAt: new Date(now.getTime() + (i === 3 ? 60_000 : -1000)),
    })),
  });
  const workers = [randomUUID(), randomUUID(), randomUUID()];
  for (const id of workers) {
    await registerWorkerInstance({ id, hostname: "test", pid: 1 });
  }
  const claims = await Promise.all(
    workers.slice(0, 2).map((workerId) =>
      claimDueBackgroundJob({
        workerId,
        lane: "small-archive",
        queueName,
        now,
      }),
    ),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  const claimed = claims.find((job) => job !== null)!;
  expect(claimed.id).toBe(small);
  await renewBackgroundJobLease({
    jobId: small,
    workerId: claimed.lockedBy!,
    now,
  });
  expect(
    await claimDueBackgroundJob({
      workerId: workers[1],
      lane: "small-archive",
      queueName,
      now,
    }),
  ).toBeNull();

  const general = await claimDueBackgroundJob({
    workerId: workers[2],
    queueName,
    now,
  });
  expect(general?.id).toBe(cleanup);
  await markBackgroundJobSucceeded({
    jobId: cleanup,
    workerId: workers[2],
    now,
  });
  expect(
    (await claimDueBackgroundJob({ workerId: workers[2], queueName, now }))?.id,
  ).toBe(large);

  await db.backgroundJob.update({
    where: { id: small },
    data: { leaseExpiresAt: new Date(now.getTime() - 1) },
  });
  const reclaimed = await claimDueBackgroundJob({
    workerId: workers[1],
    lane: "small-archive",
    queueName,
    now,
  });
  expect(reclaimed).toMatchObject({ id: small, attemptCount: 2 });
  await expect(
    renewBackgroundJobLease({ jobId: small, workerId: workers[2], now }),
  ).rejects.toThrow("could not be renewed");
  await cancelBackgroundJob({ jobId: small, actorUserId: "test-owner", now });
  await retryBackgroundJob({ jobId: small, actorUserId: "test-owner", now });
  expect(
    await claimDueBackgroundJob({ workerId: workers[2], queueName, now }),
  ).toBeNull();
  expect(
    (
      await claimDueBackgroundJob({
        workerId: workers[0],
        lane: "small-archive",
        queueName,
        now,
      })
    )?.id,
  ).toBe(small);
  expect(
    (await db.backgroundJob.findUniqueOrThrow({ where: { id: future } }))
      .attemptCount,
  ).toBe(0);
});

it("keeps small media exclusive, including queued jobs, malformed payloads and expired owners", async () => {
  const db = getPrisma();
  const queueName = randomUUID();
  const now = new Date();
  const payloads = [
    { kind: "thumbnail" },
    { kind: "poster" },
    { kind: "preview" },
    {},
    { kind: "unknown" },
    { kind: null },
  ];
  const ids = payloads.map(() => randomUUID());
  await db.backgroundJob.createMany({
    data: payloads.map((payloadJson, i) => ({
      id: ids[i],
      queueName,
      kind: "media.derivative.generate",
      payloadJson,
      runAt: new Date(now.getTime() - 1000 + i),
    })),
  });
  const workers = [randomUUID(), randomUUID()];
  for (const id of workers)
    await registerWorkerInstance({ id, hostname: "test", pid: 1 });
  const claims = await Promise.all(
    workers.map((workerId) =>
      claimDueBackgroundJob({ workerId, lane: "small-media", queueName, now }),
    ),
  );
  const claimed = claims.filter((job) => job !== null);
  expect(new Set(claimed.map((job) => job.id)).size).toBe(claimed.length);
  expect(claimed.length).toBeGreaterThan(0);
  expect(
    claimed.every((job) => ids.slice(0, 2).some((id) => id === job.id)),
  ).toBe(true);
  for (const job of claimed)
    await markBackgroundJobSucceeded({
      jobId: job.id,
      workerId: job.lockedBy!,
      now,
    });
  // A losing claim retries through the normal runner loop.
  let remaining = await claimDueBackgroundJob({
    workerId: workers[0],
    lane: "small-media",
    queueName,
    now,
  });
  if (remaining)
    await markBackgroundJobSucceeded({
      jobId: remaining.id,
      workerId: workers[0],
      now,
    });
  expect(
    await claimDueBackgroundJob({
      workerId: workers[1],
      lane: "small-media",
      queueName,
      now,
    }),
  ).toBeNull();
  const general: string[] = [];
  for (let i = 0; i < 4; i++) {
    const job = await claimDueBackgroundJob({
      workerId: workers[0],
      queueName,
      now,
    });
    expect(job).not.toBeNull();
    general.push(job!.id);
    await markBackgroundJobSucceeded({
      jobId: job!.id,
      workerId: workers[0],
      now,
    });
  }
  expect(general).toEqual(ids.slice(2));
  await db.backgroundJob.update({
    where: { id: ids[0] },
    data: {
      status: "running",
      lockedBy: workers[0],
      leaseExpiresAt: new Date(now.getTime() - 1),
    },
  });
  remaining = await claimDueBackgroundJob({
    workerId: workers[1],
    lane: "small-media",
    queueName,
    now,
  });
  expect(remaining).toMatchObject({ id: ids[0], lockedBy: workers[1] });
  await expect(
    renewBackgroundJobLease({ jobId: ids[0], workerId: workers[0], now }),
  ).rejects.toThrow("could not be renewed");
  await cancelBackgroundJob({ jobId: ids[0], actorUserId: "test-owner", now });
  await retryBackgroundJob({ jobId: ids[0], actorUserId: "test-owner", now });
  expect(
    await claimDueBackgroundJob({ workerId: workers[0], queueName, now }),
  ).toBeNull();
  expect(
    (
      await claimDueBackgroundJob({
        workerId: workers[0],
        lane: "small-media",
        queueName,
        now,
      })
    )?.id,
  ).toBe(ids[0]);
});

it("queues thumbnail bursts without losing jobs or duplicating a shared request", async () => {
  const { ensureBackgroundJobScheduled } = await import("@staaash/db/jobs");
  const db = getPrisma();
  const queueName = randomUUID();
  for (let batch = 0; batch < 4; batch++) {
    const jobs = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        ensureBackgroundJobScheduled({
          kind: "media.derivative.generate",
          queueName,
          dedupeKey: `${queueName}-${batch}-${index}`,
          runAt: new Date(),
          payloadJson: {
            fileId: "burst",
            kind: "thumbnail",
            profile: "thumb-480",
            reason: "first-view",
          },
        }),
      ),
    );
    expect(new Set(jobs.map(({ job }) => job.id)).size).toBe(5);
  }
  const same = await Promise.all(
    Array.from({ length: 5 }, () =>
      ensureBackgroundJobScheduled({
        kind: "media.derivative.generate",
        queueName,
        dedupeKey: `${queueName}-same`,
        runAt: new Date(),
        payloadJson: {
          fileId: "same",
          kind: "thumbnail",
          profile: "thumb-480",
          reason: "first-view",
        },
      }),
    ),
  );
  expect(new Set(same.map(({ job }) => job.id)).size).toBe(1);
  expect(await db.backgroundJob.count({ where: { queueName } })).toBe(21);
});

it("marks a zip failed when its job is cancelled, so asking again queues it", async () => {
  const db = getPrisma();
  const userId = randomUUID();
  await db.user.create({
    data: {
      id: userId,
      email: `${userId}@jobs.test`,
      storageId: userId,
      passwordHash: "test-only",
    },
  });
  const archive = (key: string) =>
    db.zipArchive.create({
      data: {
        userId,
        contentKey: `${userId}:${key}`,
        idsJson: [],
        status: "queued",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  const [cancelled, other] = [await archive("a"), await archive("b")];
  const job = await db.backgroundJob.create({
    data: {
      queueName: randomUUID(),
      kind: "zip.archive.generate",
      payloadJson: { archiveId: cancelled.id },
    },
  });

  await cancelBackgroundJob({ jobId: job.id, actorUserId: "test-owner" });

  const status = async (id: string) =>
    (await db.zipArchive.findUniqueOrThrow({ where: { id } })).status;
  expect(await status(cancelled.id)).toBe("failed");
  expect(await status(other.id)).toBe("queued");
});
