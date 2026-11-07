import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { expect, inject, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";

const migrationPath = new URL(
  "../../../packages/db/prisma/migrations/20261107200000_release_generated_temp_recovery/migration.sql",
  import.meta.url,
);

const GENERATED_TEMP_REASON =
  "Abandoned generated temp has no safely determined publish outcome.";

it("releases only recovery records made for abandoned generated temps", async () => {
  const db = getPrisma();
  // Each record holds its account's lock, so each needs its own account.
  const createRecovery = async (reason: string, targetKeys: string[]) => {
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@recovery.test`,
        storageId: randomUUID(),
        passwordHash: "fake",
      },
    });
    return db.storageMutation.create({
      data: {
        kind: "legacy_recovery",
        status: "recovery_required",
        ownerUserId: user.id,
        idempotencyKey: `legacy-residue:${randomUUID()}`,
        intentJson: { version: 1, metadataOperations: [], reason },
        lastError: reason,
        recoveryRequiredAt: new Date(),
        steps: {
          create: targetKeys.map((targetKey, ordinal) => ({
            ordinal,
            action: "delete_file",
            targetKey,
            expectedNodeType: "file",
          })),
        },
        resources: {
          create: { resourceKey: `owner:${user.id}`, fenceToken: 1n },
        },
      },
    });
  };
  const generated = await createRecovery(GENERATED_TEMP_REASON, [
    "tmp/derivatives/derivative-1.jpg.tmp",
    "tmp/derivatives/derivative-2.mp4.tmp",
    "tmp/archives/archive-1.zip.tmp",
  ]);
  const generatedWithOtherPath = await createRecovery(GENERATED_TEMP_REASON, [
    "tmp/derivatives/derivative-3.jpg.tmp",
    "files/storage-id/photo.jpg",
  ]);
  const cutover = await createRecovery(
    "Legacy storage residue could not be assigned a safe outcome during cutover.",
    ["tmp/derivatives/derivative-4.jpg.tmp"],
  );

  const client = new Client({
    connectionString: inject("postgresDatabaseUrl"),
  });
  await client.connect();
  try {
    await client.query(await readFile(migrationPath, "utf8"));
  } finally {
    await client.end();
  }

  const stored = await db.storageMutation.findMany({
    where: {
      id: {
        in: [generated, generatedWithOtherPath, cutover].map(({ id }) => id),
      },
    },
    select: {
      id: true,
      status: true,
      idempotencyKey: true,
      completedAt: true,
      resources: { select: { releasedAt: true } },
    },
  });
  const byId = new Map(stored.map((mutation) => [mutation.id, mutation]));
  const released = byId.get(generated.id);
  expect(released).toMatchObject({ status: "aborted", idempotencyKey: null });
  expect(released?.completedAt).toBeInstanceOf(Date);
  expect(released?.resources[0]?.releasedAt).toBeInstanceOf(Date);
  for (const kept of [generatedWithOtherPath, cutover]) {
    expect(byId.get(kept.id)).toMatchObject({
      status: "recovery_required",
      idempotencyKey: kept.idempotencyKey,
      completedAt: null,
      resources: [{ releasedAt: null }],
    });
  }
});
