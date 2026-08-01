"use server";

import { revalidatePath } from "next/cache";

import { getPrisma } from "@staaash/db/client";
import {
  buildDerivativeDedupeKey,
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_PROFILE_1080P,
  markDerivativeStale,
  scheduleDerivativeGenerate,
} from "@staaash/db/media-derivatives";

import { requireOwnerPageSession } from "@/server/auth/guards";
import { getStoragePath } from "@/server/storage";
import { runDurableStorageMutation } from "@/server/durable-storage-mutation";
import { calculateStorageFileChecksum } from "@staaash/db/storage-mutation-executor";

const revalidateDerivativeViews = () => {
  revalidatePath("/admin/jobs");
  revalidatePath("/admin");
};

export async function regenerateDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const fileId = formData.get("fileId");
  if (typeof fileId !== "string") {
    return { error: "Missing file ID." };
  }

  try {
    await scheduleDerivativeGenerate({
      fileId,
      kind: DERIVATIVE_KIND_PREVIEW,
      profile: DERIVATIVE_PROFILE_1080P,
      reason: "manual-regenerate",
    });
    revalidateDerivativeViews();
    return { success: true };
  } catch {
    return { error: "Failed to queue preview file." };
  }
}

export async function setPinDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const id = formData.get("id");
  const pinned = formData.get("pinned") === "true";

  if (typeof id !== "string") {
    return { error: "Missing preview file ID." };
  }

  const db = getPrisma();
  await db.mediaDerivative.update({
    where: { id },
    data: { pinnedByAdmin: pinned },
  });

  revalidateDerivativeViews();
  return { success: true };
}

export async function cancelDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const id = formData.get("id");
  if (typeof id !== "string") return { error: "Missing preview file ID." };

  const db = getPrisma();
  const derivative = await db.mediaDerivative.findUnique({
    where: { id },
    select: { fileId: true, status: true },
  });
  if (!derivative) return { error: "Preview file not found." };
  if (derivative.status !== "queued" && derivative.status !== "processing") {
    return {
      error: "Only queued or processing preview files can be cancelled.",
    };
  }

  const dedupeKey = buildDerivativeDedupeKey(
    derivative.fileId,
    DERIVATIVE_KIND_PREVIEW,
    DERIVATIVE_PROFILE_1080P,
  );

  if (derivative.status === "queued") {
    await db.backgroundJob.updateMany({
      where: { dedupeKey, status: "queued" },
      data: { status: "dead", lastError: "Cancelled by admin." },
    });
  } else {
    await db.backgroundJob.updateMany({
      where: { dedupeKey, status: "running" },
      data: {
        status: "dead",
        lastError: "Cancelled by admin.",
        lockedAt: null,
        lockedBy: null,
      },
    });
  }

  await markDerivativeStale(id);
  revalidateDerivativeViews();
  return { success: true };
}

export async function removeDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const id = formData.get("id");
  if (typeof id !== "string") {
    return { error: "Missing preview file ID." };
  }

  const db = getPrisma();
  const derivative = await db.mediaDerivative.findUnique({
    where: { id },
    include: { file: { select: { ownerUserId: true } } },
  });
  if (!derivative) {
    return { error: "Preview file not found." };
  }

  if (derivative.storageKey) {
    const checksum = await calculateStorageFileChecksum(
      getStoragePath(""),
      derivative.storageKey,
    );
    await runDurableStorageMutation({
      kind: "derivative_purge",
      ownerUserId: derivative.file.ownerUserId,
      idempotencyKey: `admin-derivative-purge:${id}:${derivative.storageRevision}`,
      metadataOperations: [
        {
          action: "update",
          entityType: "derivative",
          entityId: id,
          preRevision: derivative.storageRevision,
          data: { status: "stale", storageKey: null, sizeBytes: null },
        },
      ],
      steps: [
        {
          action: "delete_file",
          targetKey: derivative.storageKey,
          expectedNodeType: "file",
          expectedSizeBytes: derivative.sizeBytes,
          expectedChecksum: checksum,
        },
      ],
      entities: [
        {
          entityType: "derivative",
          entityId: id,
          preRevision: derivative.storageRevision,
          postRevision: derivative.storageRevision + 1,
          beforeJson: { storageKey: derivative.storageKey },
          afterJson: { status: "stale" },
        },
      ],
    });
  } else {
    await markDerivativeStale(id);
  }
  revalidateDerivativeViews();
  return { success: true };
}
