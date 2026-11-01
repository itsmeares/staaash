import type { z } from "zod";

import { getPrisma } from "@staaash/db/client";

import {
  ownerOnboardingSettingsSchema,
  settingsSchema,
  toSettingsValues,
  type SettingsActionState,
  type SettingsField,
} from "@/server/admin/settings-schema";
import { enqueueAdminUpdateCheck } from "@/server/admin/updates";

// Validation, save and the follow-up jobs each setting change needs.
// fallow-ignore-next-line complexity
export async function saveSystemSettings(
  raw: Record<string, unknown>,
): Promise<SettingsActionState> {
  const parsed = settingsSchema.safeParse(raw);

  if (!parsed.success) {
    const fieldErrors: SettingsActionState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as SettingsField;
      fieldErrors[field] ??= issue.message;
    }
    return { fieldErrors };
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

  return { success: true, values: toSettingsValues(parsed.data) };
}

export async function saveOwnerOnboardingSettings(
  input: z.input<typeof ownerOnboardingSettingsSchema>,
) {
  const data = ownerOnboardingSettingsSchema.parse(input);
  await getPrisma().systemSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });
}
