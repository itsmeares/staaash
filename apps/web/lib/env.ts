import { z } from "zod";
import { resolveWorkspacePath } from "@staaash/config";

const DEFAULT_APP_URL = "http://localhost:3000";
const DEFAULT_DATABASE_URL =
  "postgresql://staaash:staaash@localhost:5432/staaash";
const DEFAULT_FILES_ROOT = "./.data/files";
const DEFAULT_AUTH_SECRET = "change-me-to-a-long-random-secret";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_NAME: z.string().trim().min(1).default("Staaash"),
  APP_URL: z.string().url().default(DEFAULT_APP_URL),
  APP_VERSION: z.string().trim().min(1).default("0.1.0"),
  DATABASE_URL: z.string().trim().min(1).default(DEFAULT_DATABASE_URL),
  FILES_ROOT: z.string().trim().min(1).default(DEFAULT_FILES_ROOT),
  AUTH_SECRET: z.string().trim().min(12).default(DEFAULT_AUTH_SECRET),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024 * 1024),
  UPLOAD_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(60),
  UPLOAD_STAGING_RETENTION_HOURS: z.coerce.number().int().positive().default(2),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  INVITE_MAX_AGE_DAYS: z.coerce.number().int().positive().default(7),
  PASSWORD_RESET_MAX_AGE_HOURS: z.coerce.number().int().positive().default(4),
  SHARE_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),
  PREVIEW_MAX_SOURCE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  PREVIEW_TEXT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(64 * 1024),
  WORKER_HEARTBEAT_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(120),
  UPDATE_CHECK_INTERVAL_HOURS: z.coerce.number().int().positive().default(24),
  UPDATE_CHECK_REPOSITORY: z.string().trim().default("itsmeares/staaash"),
  UPDATE_CHECK_TOKEN: z.string().trim().optional().default(""),
});

export const env = (() => {
  const parsed = envSchema.parse(process.env);

  return {
    ...parsed,
    FILES_ROOT: resolveWorkspacePath(
      /* turbopackIgnore: true */ parsed.FILES_ROOT,
    ),
  };
})();

export const assertSecureAuthSecret = () => {
  if (
    env.NODE_ENV === "production" &&
    env.AUTH_SECRET === DEFAULT_AUTH_SECRET
  ) {
    throw new Error("AUTH_SECRET must be set to a unique value in production.");
  }
};

export const assertConfiguredAppUrl = () => {
  if (env.NODE_ENV === "production" && env.APP_URL === DEFAULT_APP_URL) {
    throw new Error("APP_URL must be set explicitly in production.");
  }
};
