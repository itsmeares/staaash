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
