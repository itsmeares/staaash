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
    updateCheckEnabled: checkboxSetting,
    // "auto" follows the running version: release candidates on a pre-release.
    updateChannel: z
      .enum(["auto", "stable", "rc"])
      .default("auto")
      .transform((value) => (value === "auto" ? null : value)),
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
        typeof value === "boolean"
          ? value
            ? "on"
            : ""
          : value === null || value === undefined
            ? "auto"
            : String(value),
      ];
    }),
  ) as SettingsValues;
}

/** What Reset to defaults puts back: the column defaults in schema.prisma. */
export const SETTINGS_DEFAULTS: SettingsValues = {
  sessionMaxAgeDays: "30",
  shareMaxAgeDays: "30",
  maxUploadBytes: "10737418240",
  uploadTimeoutMinutes: "60",
  uploadStagingRetentionHours: "2",
  resumableMaxActiveSessionsPerUser: "4",
  resumableMaxActiveSessionsInstance: "32",
  resumableMaxReservedBytesPerUser: "21474836480",
  resumableMaxReservedBytesInstance: "107374182400",
  previewMaxSourceBytes: "26214400",
  previewTextMaxBytes: "65536",
  workerHeartbeatMaxAgeSeconds: "120",
  updateCheckEnabled: "on",
  updateChannel: "auto",
  updateCheckRepository: "itsmeares/staaash",
  timeZone: DEFAULT_TIME_ZONE,
  maintenanceRunTime: DEFAULT_MAINTENANCE_RUN_TIME,
  mediaPreviewEnabled: "on",
  mediaPreviewGenerateOnUpload: "",
  mediaPreviewGenerateOnFirstView: "on",
  mediaPreviewGenerateOnShare: "on",
  mediaPreviewThresholdBytes: "367001600",
  mediaPreviewRetentionDays: "14",
  mediaPreviewMaxHeight: "1080",
  zipArchiveRetentionDays: "7",
  mediaPreviewCrf: "22",
  mediaPreviewMaxConcurrentJobs: "1",
};
