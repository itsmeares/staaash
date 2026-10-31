import { AUTO_TIME_ZONE, isValidTimeZone } from "@staaash/config/time-zone";
import { z } from "zod";

const normalizeEmail = (value: string) => value.trim().toLowerCase();

const optionalDisplayName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((value) => (value ? value : undefined));

const optionalNullableDisplayName = z
  .union([z.string().trim().max(80), z.null()])
  .optional()
  .transform((value) => (value === "" ? null : value));

const passwordSchema = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(128, "Use 128 characters or fewer.");

const storageLimitSchema = z
  .union([z.bigint(), z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null || value === "") return null;
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error("Storage quota cannot be negative.");
    return parsed;
  });

export const bootstrapInputSchema = z.object({
  instanceName: z.string().trim().min(1, "Give your drive a name.").max(80),
  email: z
    .string()
    .trim()
    .email("Enter an email like name@example.com.")
    .transform(normalizeEmail),
  displayName: optionalDisplayName,
  password: passwordSchema,
});

export const signInInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter an email like name@example.com.")
    .transform(normalizeEmail),
  password: z.string().min(1).max(128),
});

export const adminCreateUserInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter an email like name@example.com.")
    .transform(normalizeEmail),
  temporaryPassword: z.string().optional(),
  confirmTemporaryPassword: z.string().optional(),
  generateTemporaryPassword: z.boolean().optional(),
  storageLimitBytes: storageLimitSchema,
  isAdmin: z.boolean().optional(),
  requirePasswordChange: z.boolean().optional(),
});

export const adminUpdateUserInputSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Enter an email like name@example.com.")
    .transform(normalizeEmail)
    .optional(),
  displayName: optionalNullableDisplayName,
  storageLimitBytes: storageLimitSchema,
  isAdmin: z.boolean().optional(),
});

export const temporaryPasswordInputSchema = z.object({
  temporaryPassword: z.string().optional(),
  confirmTemporaryPassword: z.string().optional(),
  generateTemporaryPassword: z.boolean().optional(),
  requirePasswordChange: z.boolean().optional(),
});

export const requiredPasswordChangeInputSchema = z.object({
  password: passwordSchema,
  confirmPassword: z.string().min(1).max(128),
});

export const preferencesInputSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  timeZone: z
    .string()
    .trim()
    .refine(
      (value) => value === AUTO_TIME_ZONE || isValidTimeZone(value),
      "Invalid time zone.",
    )
    .optional(),
  showUpdateNotifications: z.boolean().optional(),
  showFolderPreviews: z.boolean().optional(),
  showPinsInSidebar: z.boolean().optional(),
  startPage: z.enum(["home", "files"]).optional(),
  defaultView: z.enum(["list", "grid"]).optional(),
  clockFormat: z.enum(["12h", "24h"]).optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  avatarUrl: z.string().max(300000).nullable().optional(),
});
