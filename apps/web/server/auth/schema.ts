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

const passwordSchema = z.string().min(12).max(128);

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
  instanceName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().transform(normalizeEmail),
  displayName: optionalDisplayName,
  password: passwordSchema,
});

export const signInInputSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: z.string().min(1).max(128),
});

export const adminCreateUserInputSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  temporaryPassword: z.string().optional(),
  confirmTemporaryPassword: z.string().optional(),
  generateTemporaryPassword: z.boolean().optional(),
  storageLimitBytes: storageLimitSchema,
  isAdmin: z.boolean().optional(),
  requirePasswordChange: z.boolean().optional(),
});

export const adminUpdateUserInputSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail).optional(),
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
