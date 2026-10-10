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

import {
  requireOwnerOnboardingSession,
  requireOwnerPageSession,
} from "@/server/auth/guards";

import {
  settingsSchema,
  toSettingsValues,
  type SettingsActionState,
  type SettingsField,
} from "./settings-schema";
import { enqueueAdminUpdateCheck } from "@/server/admin/updates";

export async function updateSystemSettings(
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  await requireOwnerPageSession();

  const raw = Object.fromEntries(formData.entries());
  const parsed = settingsSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: SettingsActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as SettingsField;
      fieldErrors[field] ??= issue.message;
    }
    return {
      error: "Check the highlighted settings. Nothing was saved.",
      fieldErrors,
    };
  }

  const db = getPrisma();
  const previous = await db.systemSettings.findUnique({
    where: { id: "singleton" },
  });
  await db.systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...parsed.data },
    update: parsed.data,
  });

  // A new channel or repository, or checks switched back on: check right away.
  if (
    parsed.data.updateCheckEnabled &&
    (previous?.updateChannel !== parsed.data.updateChannel ||
      previous?.updateCheckRepository !== parsed.data.updateCheckRepository ||
      previous?.updateCheckEnabled === false)
  ) {
    await enqueueAdminUpdateCheck();
  }

  revalidatePath("/admin/settings");
  return { success: true, values: toSettingsValues(parsed.data) };
}

const ownerOnboardingSettingsSchema = z.object({
  mediaPreviewEnabled: z.boolean(),
  mediaPreviewGenerateOnUpload: z.boolean(),
  mediaPreviewGenerateOnFirstView: z.boolean(),
  mediaPreviewGenerateOnShare: z.boolean(),
  updateCheckEnabled: z.boolean(),
  timeZone: z
    .string()
    .trim()
    .default(DEFAULT_TIME_ZONE)
    .refine(isValidTimeZone, "Invalid time zone."),
});

export async function saveOwnerOnboardingSettings(input: {
  mediaPreviewEnabled: boolean;
  mediaPreviewGenerateOnUpload: boolean;
  mediaPreviewGenerateOnFirstView: boolean;
  mediaPreviewGenerateOnShare: boolean;
  updateCheckEnabled: boolean;
  timeZone: string;
}): Promise<{ error?: string; success?: boolean }> {
  await requireOwnerOnboardingSession();

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
      mediaPreviewGenerateOnUpload: parsed.data.mediaPreviewGenerateOnUpload,
      mediaPreviewGenerateOnFirstView:
        parsed.data.mediaPreviewGenerateOnFirstView,
      mediaPreviewGenerateOnShare: parsed.data.mediaPreviewGenerateOnShare,
      updateCheckEnabled: parsed.data.updateCheckEnabled,
      timeZone: parsed.data.timeZone,
    },
    update: {
      mediaPreviewEnabled: parsed.data.mediaPreviewEnabled,
      mediaPreviewGenerateOnUpload: parsed.data.mediaPreviewGenerateOnUpload,
      mediaPreviewGenerateOnFirstView:
        parsed.data.mediaPreviewGenerateOnFirstView,
      mediaPreviewGenerateOnShare: parsed.data.mediaPreviewGenerateOnShare,
      updateCheckEnabled: parsed.data.updateCheckEnabled,
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
