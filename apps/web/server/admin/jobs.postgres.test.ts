import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { dismissBackgroundJob, retryBackgroundJob } from "@staaash/db/jobs";

it("dismisses once under concurrent requests and preserves the job in history", async () => {
  const db = getPrisma();
  const id = randomUUID();
  await db.backgroundJob.create({
    data: {
      id,
      kind: "media.derivative.generate",
      status: "dead",
      payloadJson: {},
      lastError: "Original failure",
    },
  });
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      dismissBackgroundJob({ jobId: id, actorUserId: "test-owner" }),
    ),
  );
  expect(results.filter((result) => result.actionApplied)).toHaveLength(1);
  expect(await db.backgroundJob.findUnique({ where: { id } })).toMatchObject({
    status: "cancelled",
    lastError: "Original failure",
  });
  expect(
    await db.backgroundJobEvent.count({
      where: { jobId: id, type: "dismissed" },
    }),
  ).toBe(1);
  expect(
    await retryBackgroundJob({
      jobId: id,
      actorUserId: "test-owner",
      failedOnly: true,
    }),
  ).toMatchObject({ status: "cancelled", actionApplied: false });
  expect(
    await retryBackgroundJob({ jobId: id, actorUserId: "test-owner" }),
  ).toMatchObject({ status: "queued", actionApplied: true });
  expect(
    await dismissBackgroundJob({ jobId: id, actorUserId: "test-owner" }),
  ).toMatchObject({ status: "queued", actionApplied: false });
});
