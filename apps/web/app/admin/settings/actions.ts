"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getPrisma } from "@staaash/db/client";
import {
  DEFAULT_MAINTENANCE_RUN_TIME,
  DEFAULT_TIME_ZONE,
  isValidMaintenanceRunTime,
  isValidTimeZone,
} from "@staaash/config/time-zone";

import { requireOwnerPageSession } from "@/server/auth/guards";

const updateSettingsSchema = z
  .object({
    sessionMaxAgeDays: z.coerce.number().int().positive(),
    shareMaxAgeDays: z.coerce.number().int().positive(),
    maxUploadBytes: z.coerce.bigint().positive(),
    uploadTimeoutMinutes: z.coerce.number().int().positive(),
    uploadStagingRetentionHours: z.coerce.number().int().positive(),
    resumableMaxActiveSessionsPerUser: z.coerce.number().int().positive(),
    resumableMaxActiveSessionsInstance: z.coerce.number().int().positive(),
    resumableMaxReservedBytesPerUser: z.coerce.bigint().positive(),
    resumableMaxReservedBytesInstance: z.coerce.bigint().positive(),
    previewMaxSourceBytes: z.coerce.number().int().positive(),
    previewTextMaxBytes: z.coerce.number().int().positive(),
    workerHeartbeatMaxAgeSeconds: z.coerce.number().int().positive(),
    updateCheckIntervalHours: z.coerce.number().int().positive(),
    updateCheckRepository: z.string().trim(),
    timeZone: z
      .string()
      .trim()
      .default(DEFAULT_TIME_ZONE)
      .refine(isValidTimeZone, "Invalid time zone."),
    maintenanceRunTime: z
      .string()
      .trim()
      .default(DEFAULT_MAINTENANCE_RUN_TIME)
      .refine(isValidMaintenanceRunTime, "Invalid maintenance run time."),
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
    zipArchiveRetentionDays: z.coerce.number().int().min(0),
    mediaPreviewCrf: z.coerce.number().int().min(0).max(51),
    mediaPreviewMaxConcurrentJobs: z.coerce.number().int().positive(),
  })
  .superRefine((value, context) => {
    if (
      value.resumableMaxActiveSessionsInstance <
      value.resumableMaxActiveSessionsPerUser
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Instance active sessions must be at least the per-user limit.",
        path: ["resumableMaxActiveSessionsInstance"],
      });
    }
    if (value.resumableMaxReservedBytesPerUser < value.maxUploadBytes) {
      context.addIssue({
        code: "custom",
        message: "Per-user staged bytes must allow one maximum-size upload.",
        path: ["resumableMaxReservedBytesPerUser"],
      });
    }
    if (
      value.resumableMaxReservedBytesInstance <
      value.resumableMaxReservedBytesPerUser
    ) {
      context.addIssue({
        code: "custom",
        message: "Instance staged bytes must be at least the per-user limit.",
        path: ["resumableMaxReservedBytesInstance"],
      });
    }
  });

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

const ownerOnboardingSettingsSchema = z.object({
  mediaPreviewEnabled: z.boolean(),
  timeZone: z
    .string()
    .trim()
    .default(DEFAULT_TIME_ZONE)
    .refine(isValidTimeZone, "Invalid time zone."),
});

export async function saveOwnerOnboardingSettings(input: {
  mediaPreviewEnabled: boolean;
  timeZone: string;
}): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();

  const parsed = ownerOnboardingSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const db = getPrisma();
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      mediaPreviewEnabled: parsed.data.mediaPreviewEnabled,
      timeZone: parsed.data.timeZone,
    },
    update: {
      mediaPreviewEnabled: parsed.data.mediaPreviewEnabled,
      timeZone: parsed.data.timeZone,
    },
  });

  revalidatePath("/admin/settings");
  return { success: true };
}

async function setMediaPreviewEnabled(
  enabled: boolean,
): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerPageSession();
  const db = getPrisma();
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", mediaPreviewEnabled: enabled },
    update: { mediaPreviewEnabled: enabled },
  });
  revalidatePath("/admin/settings");
  return { success: true };
}
