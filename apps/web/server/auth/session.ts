import { cookies } from "next/headers";

import { authService } from "@/server/auth/service";
import { env } from "@/lib/env";

export const SESSION_COOKIE_NAME = "staaash_session";

const baseCookie = {
  name: SESSION_COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
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

export const getSessionTokenFromCookieStore = (cookieStore: {
  get(name: string): { value: string } | undefined;
}) => cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;

export const getCurrentSession = async () => {
  const cookieStore = await cookies();
  return authService.getSession(getSessionTokenFromCookieStore(cookieStore));
};
