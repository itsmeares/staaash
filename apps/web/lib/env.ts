import { z } from "zod";
import { resolveWorkspacePath } from "@staaash/config";

const parseSecureCookies = (val: string | undefined, ctx: z.RefinementCtx) => {
  if (val === undefined) return undefined;
  const trimmed = val.trim();
  if (trimmed === "") return undefined;

  const normalized = trimmed.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message: "SECURE_COOKIES must be true or false when set.",
  });
  return z.NEVER;
};

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .trim()
    .min(1)
    .default("postgresql://postgres:staaash@localhost:5432/staaash"),
  UPLOAD_LOCATION: z.string().trim().min(1).default("./.data/files"),
  SECURE_COOKIES: z.string().optional().transform(parseSecureCookies),
});

export const parseWebEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = envSchema.parse(rawEnv);

  return {
    ...parsed,
    UPLOAD_LOCATION: resolveWorkspacePath(
      /* turbopackIgnore: true */ parsed.UPLOAD_LOCATION,
    ),
  };
};

export const env = parseWebEnv(process.env);
