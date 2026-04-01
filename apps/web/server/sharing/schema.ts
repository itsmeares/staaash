import { z } from "zod";

const truthyValues = new Set(["1", "on", "true", "yes"]);

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

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime()) ? value : parsed;
  }

  return value;
}, z.date().optional());

export const shareTargetTypeSchema = z.enum(["file", "folder"]);

export const createShareSchema = z
  .object({
    targetType: shareTargetTypeSchema,
    fileId: z.string().trim().min(1).optional(),
    folderId: z.string().trim().min(1).optional(),
    expiresAt: coerceOptionalDate,
    downloadDisabled: coerceBoolean.default(false),
    password: z.string().trim().min(8).max(256).optional(),
    redirectTo: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
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
  expiresAt: z.preprocess((value) => {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value === "string") {
      const parsed = new Date(value);

      return Number.isNaN(parsed.getTime()) ? value : parsed;
    }

    return value;
  }, z.date()),
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
