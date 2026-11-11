import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { getStorageMutationHealth } from "@staaash/db/storage-mutations";

it("finds a selected recovery beyond the health preview and drops it once finished", async () => {
  const db = getPrisma();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@recovery.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const ids = Array.from({ length: 26 }, () => randomUUID());
  await db.storageMutation.createMany({
    data: ids.map((id, index) => ({
      id,
      ownerUserId: owner.id,
      kind: "folder_move",
      status: "recovery_required",
      intentJson: {},
      lastError: "Both rename source and target exist.",
      createdAt: new Date(2026, 0, 1, 0, index),
    })),
  });
  const selectedId = ids.at(-1)!;
  const preview = await getStorageMutationHealth();
  expect(preview.active).toHaveLength(25);
  expect(preview.active.some((mutation) => mutation.id === selectedId)).toBe(
    false,
  );

  const selected = await getStorageMutationHealth(new Date(), selectedId);
  expect(selected.active).toMatchObject([
    {
      id: selectedId,
      status: "recovery_required",
      lastError: "Both rename source and target exist.",
      canRetryNow: false,
    },
  ]);
  expect(selected.active).toHaveLength(1);
  expect(
    (await getStorageMutationHealth(new Date(), "missing")).active,
  ).toEqual([]);

  await db.storageMutation.update({
    where: { id: selectedId },
    data: { status: "succeeded" },
  });
  expect(
    (await getStorageMutationHealth(new Date(), selectedId)).active,
  ).toEqual([]);
});
