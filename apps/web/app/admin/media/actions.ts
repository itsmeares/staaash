"use server";

import { rm } from "node:fs/promises";

import { revalidatePath } from "next/cache";

import { getPrisma } from "@staaash/db/client";
import {
  scheduleDerivativeGenerate,
  markDerivativeStale,
  buildDerivativeDedupeKey,
  DERIVATIVE_KIND_PREVIEW,
  DERIVATIVE_PROFILE_1080P,
} from "@staaash/db/media-derivatives";

import { requireOwnerPageSession } from "@/server/auth/guards";
import { getStoragePath } from "@/server/storage";

export async function regenerateDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const fileId = formData.get("fileId");
  if (typeof fileId !== "string") {
    return { error: "Missing fileId." };
  }

  try {
    await scheduleDerivativeGenerate({
      fileId,
      kind: DERIVATIVE_KIND_PREVIEW,
      profile: DERIVATIVE_PROFILE_1080P,
      reason: "manual-regenerate",
    });
    revalidatePath("/admin/media");
    return { success: true };
  } catch {
    return { error: "Failed to schedule regeneration." };
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
    return { error: "Missing id." };
  }

  const db = getPrisma();
  await db.mediaDerivative.update({
    where: { id },
    data: { pinnedByAdmin: pinned },
  });

  revalidatePath("/admin/media");
  return { success: true };
}

export async function cancelDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const id = formData.get("id");
  if (typeof id !== "string") return { error: "Missing id." };

  const db = getPrisma();
  const derivative = await db.mediaDerivative.findUnique({
    where: { id },
    select: { fileId: true, status: true },
  });
  if (!derivative) return { error: "Derivative not found." };
  if (derivative.status !== "queued" && derivative.status !== "processing")
    return { error: "Only queued or processing derivatives can be cancelled." };

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
    // Mark the running job dead immediately so:
    // 1. The UI shows "dead" without waiting for the worker
    // 2. The job can't be re-claimed after its 60s lease expires
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
  revalidatePath("/admin/media");
  return { success: true };
}

export async function removeDerivative(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const id = formData.get("id");
  if (typeof id !== "string") {
    return { error: "Missing id." };
  }

  const db = getPrisma();
  const derivative = await db.mediaDerivative.findUnique({ where: { id } });
  if (!derivative) {
    return { error: "Derivative not found." };
  }

  if (derivative.storageKey) {
    await rm(getStoragePath(derivative.storageKey), { force: true });
  }

  await markDerivativeStale(id);

  revalidatePath("/admin/media");
  return { success: true };
}
