import { createHash } from "node:crypto";

import { env } from "@/lib/env";

export const SHARE_ACCESS_COOKIE_NAME = "staaash_share_access";

const signValue = (value: string) =>
  createHash("sha256")
    .update(env.AUTH_SECRET)
    .update(":share-access:")
    .update(value)
    .digest("base64url");

const baseCookie = {
  name: SHARE_ACCESS_COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: env.NODE_ENV === "production",
};

type ShareCookiePayload = {
  shareId: string;
  tokenLookupKey: string;
  passwordHash: string;
};

const serializePayload = (payload: ShareCookiePayload) =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

const deserializePayload = (value: string): ShareCookiePayload | null => {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<ShareCookiePayload>;

    if (
      typeof parsed.shareId !== "string" ||
      typeof parsed.tokenLookupKey !== "string" ||
      typeof parsed.passwordHash !== "string"
    ) {
      return null;
    }

    return {
      shareId: parsed.shareId,
      tokenLookupKey: parsed.tokenLookupKey,
      passwordHash: parsed.passwordHash,
    };
  } catch {
    return null;
  }
};

export const buildShareAccessCookie = ({
  shareId,
  tokenLookupKey,
  passwordHash,
  token,
}: ShareCookiePayload & {
  token: string;
}) => {
  const payload = serializePayload({
    shareId,
    tokenLookupKey,
    passwordHash,
  });

  return {
    ...baseCookie,
    path: `/s/${encodeURIComponent(token)}`,
    value: `${payload}.${signValue(payload)}`,
  };
};

export const buildClearedShareAccessCookie = (token: string) => ({
  ...baseCookie,
  path: `/s/${encodeURIComponent(token)}`,
  value: "",
  expires: new Date(0),
  maxAge: 0,
});

export const verifyShareAccessCookie = ({
  cookieValue,
  shareId,
  tokenLookupKey,
  passwordHash,
}: {
  cookieValue: string | null | undefined;
  shareId: string;
  tokenLookupKey: string;
  passwordHash: string | null;
}) => {
  if (!passwordHash || !cookieValue) {
    return false;
  }

  const separatorIndex = cookieValue.lastIndexOf(".");

  if (separatorIndex <= 0) {
    return false;
  }

  const payloadValue = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);

  if (signValue(payloadValue) !== signature) {
    return false;
  }

  const payload = deserializePayload(payloadValue);

  return (
    payload?.shareId === shareId &&
    payload.tokenLookupKey === tokenLookupKey &&
    payload.passwordHash === passwordHash
  );
};
