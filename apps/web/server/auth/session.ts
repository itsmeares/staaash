import { cookies } from "next/headers";

import { authService } from "@/server/auth/service";
import {
  type CookieRequestContext,
  resolveSecureCookie,
} from "@/server/cookie-security";

// fallow-ignore-next-line unused-export
export const SESSION_COOKIE_NAME = "staaash_session";
// fallow-ignore-next-line unused-export
export const ONBOARDED_COOKIE_NAME = "staaash_onboarded";
export const THEME_COOKIE_NAME = "staaash_theme";

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
