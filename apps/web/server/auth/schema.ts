import { z } from "zod";

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const optionalDisplayName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .optional()
  .transform((value) => value || undefined);

export const bootstrapInputSchema = z.object({
  instanceName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().transform(normalizeEmail),
  displayName: optionalDisplayName,
  password: z.string().min(12).max(128),
});

export const signInInputSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
  password: z.string().min(1).max(128),
});

export const createInviteInputSchema = z.object({
  email: z.string().trim().email().transform(normalizeEmail),
});

export const redeemInviteInputSchema = z.object({
  token: z.string().trim().min(1),
  displayName: optionalDisplayName,
  password: z.string().min(12).max(128),
});

export const issuePasswordResetInputSchema = z.object({
  userId: z.string().trim().min(1),
});

export const redeemPasswordResetInputSchema = z.object({
  token: z.string().trim().min(1),
  password: z.string().min(12).max(128),
});
