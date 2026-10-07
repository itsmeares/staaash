import { z } from "zod";
import {
  DEFAULT_MAINTENANCE_RUN_TIME,
  DEFAULT_TIME_ZONE,
  isValidMaintenanceRunTime,
  isValidTimeZone,
} from "@staaash/config/time-zone";

const integerSetting = (min = 1, max = 2147483647) =>
  z
    .string()
    .trim()
    .min(1, "Enter a whole number.")
    .pipe(
      z.coerce
        .number<string>()
        .int("Enter a whole number.")
        .min(min, `Use ${min} or more.`)
        .max(max, `Use ${max.toLocaleString("en-GB")} or less.`),
    );
const byteSetting = z
  .string()
  .trim()
  .min(1, "Enter a byte limit.")
  .pipe(
    z.coerce
      .bigint<string>()
      .positive("Use at least 1 byte.")
      .max(
        9223372036854775807n,
        "Use 9,223,372,036,854,775,807 bytes or less.",
      ),
  );
const checkboxSetting = z
  .string()
  .optional()
  .transform((value) => value === "on");

export const settingsSchema = z
  .object({
    sessionMaxAgeDays: integerSetting(),
    shareMaxAgeDays: integerSetting(),
    maxUploadBytes: byteSetting,
    uploadTimeoutMinutes: integerSetting(),
    uploadStagingRetentionHours: integerSetting(),
    resumableMaxActiveSessionsPerUser: integerSetting(),
    resumableMaxActiveSessionsInstance: integerSetting(),
    resumableMaxReservedBytesPerUser: byteSetting,
    resumableMaxReservedBytesInstance: byteSetting,
    previewMaxSourceBytes: integerSetting(),
    previewTextMaxBytes: integerSetting(),
    workerHeartbeatMaxAgeSeconds: integerSetting(),
    updateCheckIntervalHours: integerSetting(),
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
    mediaPreviewEnabled: checkboxSetting,
    mediaPreviewGenerateOnUpload: checkboxSetting,
    mediaPreviewGenerateOnFirstView: checkboxSetting,
    mediaPreviewGenerateOnShare: checkboxSetting,
    mediaPreviewThresholdBytes: byteSetting,
    mediaPreviewRetentionDays: integerSetting(0),
    mediaPreviewMaxHeight: integerSetting(),
    zipArchiveRetentionDays: integerSetting(0),
    mediaPreviewCrf: integerSetting(0, 51),
    mediaPreviewMaxConcurrentJobs: integerSetting(),
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

export type SettingsField = keyof z.infer<typeof settingsSchema>;
export type SettingsValues = Record<SettingsField, string>;
export type SettingsActionState = {
  error?: string;
  fieldErrors?: Partial<Record<SettingsField, string>>;
  success?: boolean;
  values?: SettingsValues;
};

export function toSettingsValues(
  settings: Record<string, unknown>,
): SettingsValues {
  return Object.fromEntries(
    Object.keys(settingsSchema.shape).map((name) => {
      const value = settings[name];
      return [
        name,
        typeof value === "boolean" ? (value ? "on" : "") : String(value),
      ];
    }),
  ) as SettingsValues;
}
