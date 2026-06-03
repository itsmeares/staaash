import { cookies } from "next/headers";

import { authService } from "@/server/auth/service";
import { env } from "@/lib/env";

// fallow-ignore-next-line unused-export
export const SESSION_COOKIE_NAME = "staaash_session";
// fallow-ignore-next-line unused-export
export const ONBOARDED_COOKIE_NAME = "staaash_onboarded";
export const THEME_COOKIE_NAME = "staaash_theme";

type CookieRequestContext = {
  headers?: {
    get(name: string): string | null;
  };
  nextUrl?: {
    protocol?: string;
  };
  url?: string;
};

const normalizeProtocol = (protocol: string) =>
  protocol.replace(/:$/, "").trim().toLowerCase();

const getForwardedProtocol = (context?: CookieRequestContext) => {
  const proto = context?.headers
    ?.get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  return proto ? normalizeProtocol(proto) : null;
};

const getRequestProtocol = (context?: CookieRequestContext) => {
  const forwardedProtocol = getForwardedProtocol(context);
  if (forwardedProtocol) return forwardedProtocol;

  const nextUrlProtocol = context?.nextUrl?.protocol;
  if (nextUrlProtocol) return normalizeProtocol(nextUrlProtocol);

  if (context?.url) {
    try {
      return normalizeProtocol(new URL(context.url).protocol);
    } catch {
      return null;
    }
  }

  return null;
};

const resolveSecureCookie = (context?: CookieRequestContext) => {
  if (env.SECURE_COOKIES !== undefined) {
    return env.SECURE_COOKIES;
  }

  const protocol = getRequestProtocol(context);
  if (protocol) {
    return protocol === "https";
  }

  return env.NODE_ENV === "production";
};

const baseCookie = (context?: CookieRequestContext) => ({
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: resolveSecureCookie(context),
  path: "/",
});

export const buildSessionCookie = (
  value: string,
  expiresAt: Date,
  context?: CookieRequestContext,
) => ({
  ...baseCookie(context),
  value,
  expires: expiresAt,
});

export const buildClearedSessionCookie = (context?: CookieRequestContext) => ({
  ...baseCookie(context),
  value: "",
  expires: new Date(0),
  maxAge: 0,
});

export const buildOnboardedCookie = (context?: CookieRequestContext) => ({
  name: ONBOARDED_COOKIE_NAME,
  value: "1",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: resolveSecureCookie(context),
  path: "/",
  maxAge: 60 * 60 * 24 * 365 * 10,
});

export const buildClearedOnboardedCookie = (
  context?: CookieRequestContext,
) => ({
  name: ONBOARDED_COOKIE_NAME,
  value: "",
  secure: resolveSecureCookie(context),
  expires: new Date(0),
  maxAge: 0,
  path: "/",
});

export const buildThemeCookie = (
  theme: string,
  context?: CookieRequestContext,
) => ({
  name: THEME_COOKIE_NAME,
  value: theme,
  httpOnly: false,
  sameSite: "lax" as const,
  secure: resolveSecureCookie(context),
  path: "/",
  maxAge: 60 * 60 * 24 * 365 * 10,
});

export const getSessionTokenFromCookieStore = (cookieStore: {
  get(name: string): { value: string } | undefined;
}) => cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;

export const getCurrentSession = async () => {
  const cookieStore = await cookies();
  return authService.getSession(getSessionTokenFromCookieStore(cookieStore));
};
