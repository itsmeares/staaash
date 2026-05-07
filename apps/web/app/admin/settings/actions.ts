"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPrisma } from "@staaash/db/client";

import { requireOwnerPageSession } from "@/server/auth/guards";

const updateSettingsSchema = z.object({
  sessionMaxAgeDays: z.coerce.number().int().positive(),
  inviteMaxAgeDays: z.coerce.number().int().positive(),
  passwordResetMaxAgeHours: z.coerce.number().int().positive(),
  shareMaxAgeDays: z.coerce.number().int().positive(),
  maxUploadBytes: z.coerce.bigint().positive(),
  uploadTimeoutMinutes: z.coerce.number().int().positive(),
  uploadStagingRetentionHours: z.coerce.number().int().positive(),
  previewMaxSourceBytes: z.coerce.number().int().positive(),
  previewTextMaxBytes: z.coerce.number().int().positive(),
  workerHeartbeatMaxAgeSeconds: z.coerce.number().int().positive(),
  updateCheckIntervalHours: z.coerce.number().int().positive(),
  updateCheckRepository: z.string().trim(),
  mediaPreviewEnabled: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  mediaPreviewGenerateOnUpload: z
    .string()
    .optional()
    .transform((v) => v === "on"),
  mediaPreviewThresholdBytes: z.coerce.bigint().positive(),
  mediaPreviewRetentionDays: z.coerce.number().int().min(0),
  mediaPreviewMaxHeight: z.coerce.number().int().positive(),
  mediaPreviewCrf: z.coerce.number().int().min(0).max(51),
  mediaPreviewMaxConcurrentJobs: z.coerce.number().int().positive(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

export async function updateSystemSettings(
  _prevState: { error?: string; success?: boolean },
  formData: FormData,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const raw = Object.fromEntries(formData.entries());
  const parsed = updateSettingsSchema.safeParse(raw);

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const db = getPrisma();
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });

  revalidatePath("/admin/settings");
  return { success: true };
}
