import { z } from "zod";
import { resolveWorkspacePath } from "@staaash/config";

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
  SECURE_COOKIES: z
    .string()
    .optional()
    .transform((val) => {
      if (val === undefined || val === "") return undefined;
      return val.toLowerCase() !== "false";
    }),
});

export const env = (() => {
  const parsed = envSchema.parse(process.env);

  return {
    ...parsed,
    UPLOAD_LOCATION: resolveWorkspacePath(
      /* turbopackIgnore: true */ parsed.UPLOAD_LOCATION,
    ),
  };
})();
