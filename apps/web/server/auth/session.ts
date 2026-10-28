import {
  type CookieRequestContext,
  resolveSecureCookie,
} from "@/server/cookie-security";

export const SESSION_COOKIE_NAME = "staaash_session";
const THEME_COOKIE_NAME = "staaash_theme";

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
  // Browsers cap cookies at 400 days.
  maxAge: 60 * 60 * 24 * 400,
});
