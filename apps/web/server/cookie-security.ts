import { env } from "@/lib/env";

export type CookieRequestContext = {
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

export const resolveSecureCookie = (context?: CookieRequestContext) => {
  if (env.SECURE_COOKIES !== undefined) {
    return env.SECURE_COOKIES;
  }

  const protocol = getRequestProtocol(context);
  if (protocol) {
    return protocol === "https";
  }

  return env.NODE_ENV === "production";
};
