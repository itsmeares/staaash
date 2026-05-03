import { cookies } from "next/headers";

import { authService } from "@/server/auth/service";
import { env } from "@/lib/env";

export const SESSION_COOKIE_NAME = "staaash_session";
export const ONBOARDED_COOKIE_NAME = "staaash_onboarded";
export const THEME_COOKIE_NAME = "staaash_theme";

const isSecure =
  env.SECURE_COOKIES !== undefined
    ? env.SECURE_COOKIES
    : env.NODE_ENV === "production";

const baseCookie = {
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isSecure,
  path: "/",
};

export const buildSessionCookie = (value: string, expiresAt: Date) => ({
  ...baseCookie,
  value,
  expires: expiresAt,
});

export const buildClearedSessionCookie = () => ({
  ...baseCookie,
  value: "",
  expires: new Date(0),
  maxAge: 0,
});

export const buildOnboardedCookie = () => ({
  name: ONBOARDED_COOKIE_NAME,
  value: "1",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isSecure,
  path: "/",
  maxAge: 60 * 60 * 24 * 365 * 10,
});

export const buildClearedOnboardedCookie = () => ({
  name: ONBOARDED_COOKIE_NAME,
  value: "",
  expires: new Date(0),
  maxAge: 0,
  path: "/",
});

export const buildThemeCookie = (theme: string) => ({
  name: THEME_COOKIE_NAME,
  value: theme,
  httpOnly: false,
  sameSite: "lax" as const,
  secure: isSecure,
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
