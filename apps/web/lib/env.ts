import { z } from "zod";
import {
  normalizeOptionalEnvValue,
  resolveWorkspacePath,
} from "@staaash/config";

const optionalPositiveInteger = z.preprocess(
  normalizeOptionalEnvValue,
  z.coerce.number().int().positive().optional(),
);

const parseBoolean =
  (name: string) => (val: string | undefined, ctx: z.RefinementCtx) => {
    const normalized = val?.trim().toLowerCase();
    if (!normalized) return undefined;
    if (normalized === "true") return true;
    if (normalized === "false") return false;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${name} must be true or false when set.`,
    });
    return z.NEVER;
  };

/** An OIDC issuer is compared character by character, so `exact` keeps it as typed. */
const parseUrl =
  (name: string, exact = false) =>
  (val: string | undefined, ctx: z.RefinementCtx) => {
    const trimmed = val?.trim();
    if (!trimmed) return undefined;

    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${name} must be a valid http:// or https:// URL.`,
      });
      return z.NEVER;
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${name} must use http:// or https://.`,
      });
      return z.NEVER;
    }

    return exact ? trimmed : url.toString().replace(/\/$/, "");
  };

const optionalText = z.preprocess(
  normalizeOptionalEnvValue,
  z.string().trim().optional(),
);

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
  UPLOAD_STAGING_RETENTION_HOURS: optionalPositiveInteger,
  SECURE_COOKIES: z
    .string()
    .optional()
    .transform(parseBoolean("SECURE_COOKIES")),
  STAAASH_PUBLIC_URL: z
    .string()
    .optional()
    .transform(parseUrl("STAAASH_PUBLIC_URL")),
  OIDC_ISSUER_URL: z
    .string()
    .optional()
    .transform(parseUrl("OIDC_ISSUER_URL", true)),
  OIDC_CLIENT_ID: optionalText,
  OIDC_CLIENT_SECRET: optionalText,
  OIDC_PROVIDER_NAME: optionalText,
  OIDC_AUTO_REGISTER: z
    .string()
    .optional()
    .transform(parseBoolean("OIDC_AUTO_REGISTER")),
  OIDC_DEFAULT_STORAGE_LIMIT_GB: z.preprocess(
    normalizeOptionalEnvValue,
    z.coerce.number().positive().optional(),
  ),
  OIDC_ADMIN_GROUP: optionalText,
  OIDC_PASSWORD_LOGIN: z
    .string()
    .optional()
    .transform(parseBoolean("OIDC_PASSWORD_LOGIN")),
});

type ParsedEnv = z.infer<typeof envSchema>;

const DISCOVERY_SUFFIX = "/.well-known/openid-configuration";

/**
 * Single sign-on, when OIDC_ISSUER_URL is set. A half-set config stops
 * startup instead of showing a button that cannot work.
 */
const parseOidc = (parsed: ParsedEnv) => {
  const issuer = parsed.OIDC_ISSUER_URL;
  if (!issuer) {
    if (parsed.OIDC_PASSWORD_LOGIN === false) {
      throw new Error(
        "OIDC_PASSWORD_LOGIN=false needs OIDC_ISSUER_URL, or nobody could sign in.",
      );
    }
    return null;
  }
  if (!parsed.OIDC_CLIENT_ID) {
    throw new Error("OIDC_ISSUER_URL is set, so OIDC_CLIENT_ID is required.");
  }
  if (!parsed.STAAASH_PUBLIC_URL) {
    throw new Error(
      "OIDC_ISSUER_URL is set, so STAAASH_PUBLIC_URL is required for the callback address.",
    );
  }
  const limitGb = parsed.OIDC_DEFAULT_STORAGE_LIMIT_GB;
  return {
    // Pocket ID shows the discovery URL; the issuer check needs the issuer.
    issuer: issuer.endsWith(DISCOVERY_SUFFIX)
      ? issuer.slice(0, -DISCOVERY_SUFFIX.length)
      : issuer,
    clientId: parsed.OIDC_CLIENT_ID,
    clientSecret: parsed.OIDC_CLIENT_SECRET ?? null,
    providerName: parsed.OIDC_PROVIDER_NAME || "SSO",
    autoRegister: parsed.OIDC_AUTO_REGISTER ?? false,
    defaultStorageLimitBytes:
      limitGb === undefined ? null : BigInt(Math.round(limitGb * 1024 ** 3)),
    adminGroup: parsed.OIDC_ADMIN_GROUP || null,
    passwordLogin: parsed.OIDC_PASSWORD_LOGIN ?? true,
    startUrl: `${parsed.STAAASH_PUBLIC_URL}/api/auth/oidc/start`,
    callbackUrl: `${parsed.STAAASH_PUBLIC_URL}/api/auth/oidc/callback`,
  };
};

export type OidcEnv = NonNullable<ReturnType<typeof parseOidc>>;

export const parseWebEnv = (rawEnv: NodeJS.ProcessEnv) => {
  const parsed = envSchema.parse(rawEnv);

  return {
    ...parsed,
    oidc: parseOidc(parsed),
    UPLOAD_LOCATION: resolveWorkspacePath(
      /* turbopackIgnore: true */ parsed.UPLOAD_LOCATION,
    ),
  };
};

export const env = parseWebEnv(process.env);
