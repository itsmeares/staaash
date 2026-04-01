import { z } from "zod";

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const usernamePattern = /^(?!-)(?!.*--)[a-z0-9-]{3,32}(?<!-)$/;
const normalizeUsername = (value: string) => value.trim().toLowerCase();
const optionalDisplayName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .optional()
  .transform((value) => value || undefined);
const usernameSchema = z
  .string()
  .trim()
  .min(1, "Username is required.")
  .transform(normalizeUsername)
  .refine((value) => usernamePattern.test(value), {
    message:
      "Username must be 3-32 characters using lowercase letters, numbers, and single hyphens.",
  });

export const bootstrapInputSchema = z.object({
  instanceName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().transform(normalizeEmail),
  username: usernameSchema,
  displayName: optionalDisplayName,
  password: z.string().min(12).max(128),
});

export const signInInputSchema = z.object({
  identifier: z.string().trim().min(1).max(128),
  password: z.string().min(1).max(128),
});

export const createInviteInputSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
});

export const redeemInviteInputSchema = z.object({
  token: z.string().trim().min(1),
  username: usernameSchema,
  displayName: optionalDisplayName,
  password: z.string().min(12).max(128),
});

export const normalizeAuthIdentifier = (value: string) => value.trim();
export const isEmailIdentifier = (value: string) => value.includes("@");
export const parseUsernameIdentifier = (value: string) =>
  usernameSchema.safeParse(value);

export const issuePasswordResetInputSchema = z.object({
  userId: z.string().trim().min(1),
});

export const redeemPasswordResetInputSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(12).max(128),
});
