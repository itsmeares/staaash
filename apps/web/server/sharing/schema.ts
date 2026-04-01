import { z } from "zod";

const truthyValues = new Set(["1", "on", "true", "yes"]);
const dateTimeLocalPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const coerceBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truthyValues.has(value.trim().toLowerCase());
  }

  return false;
}, z.boolean());

const coerceOptionalDate = z.preprocess((value) => {
  if (value == null || value === "") {
    return undefined;
  }

  return parseDateTimeLocalValue(value);
}, z.date().optional());

export const shareTargetTypeSchema = z.enum(["file", "folder"]);
export const shareMutationModeSchema = z.enum(["create", "reissue"]);

const parseDateTimeLocalValue = (value: unknown) => {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!dateTimeLocalPattern.test(trimmed)) {
    const parsed = new Date(trimmed);

    return Number.isNaN(parsed.getTime()) ? value : parsed;
  }

  const [datePart, timePart] = trimmed.split("T");
  const [year, month, day] = datePart.split("-").map((part) => Number(part));
  const [hours, minutes] = timePart.split(":").map((part) => Number(part));
  const parsed = new Date(year, month - 1, day, hours, minutes);

  return Number.isNaN(parsed.getTime()) ? value : parsed;
};

const padDateTimePart = (value: number) => String(value).padStart(2, "0");

export const formatDateTimeLocalValue = (value: Date) => {
  const parsed = new Date(value);

  return (
    [
      parsed.getFullYear(),
      padDateTimePart(parsed.getMonth() + 1),
      padDateTimePart(parsed.getDate()),
    ].join("-") +
    "T" +
    [
      padDateTimePart(parsed.getHours()),
      padDateTimePart(parsed.getMinutes()),
    ].join(":")
  );
};

export const createShareSchema = z
  .object({
    mode: shareMutationModeSchema.default("create"),
    shareId: z.string().trim().min(1).optional(),
    targetType: shareTargetTypeSchema.optional(),
    fileId: z.string().trim().min(1).optional(),
    folderId: z.string().trim().min(1).optional(),
    expiresAt: coerceOptionalDate,
    downloadDisabled: coerceBoolean.default(false),
    password: z.string().trim().min(8).max(256).optional(),
    redirectTo: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (value.mode === "reissue") {
      if (!value.shareId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "A share ID is required to reissue a public link.",
          path: ["shareId"],
        });
      }

      return;
    }

    if (!value.targetType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A share target type is required.",
        path: ["targetType"],
      });
      return;
    }

    if (value.targetType === "file" && !value.fileId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A file share requires a file ID.",
        path: ["fileId"],
      });
    }

    if (value.targetType === "folder" && !value.folderId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A folder share requires a folder ID.",
        path: ["folderId"],
      });
    }
  });

export const updateShareSchema = z.object({
  expiresAt: z.preprocess((value) => parseDateTimeLocalValue(value), z.date()),
  downloadDisabled: coerceBoolean.default(false),
  redirectTo: z.string().trim().optional(),
});

export const updateSharePasswordSchema = z
  .object({
    password: z.string().trim().min(8).max(256).optional(),
    clear: coerceBoolean.default(false),
    redirectTo: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (!value.clear && !value.password) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a password to protect this link.",
        path: ["password"],
      });
    }
  });

export const unlockShareSchema = z.object({
  password: z.string().trim().min(1).max(256),
  redirectTo: z.string().trim().optional(),
});
