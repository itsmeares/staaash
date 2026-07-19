import { createHmac } from "node:crypto";

import {
  type CookieRequestContext,
  resolveSecureCookie,
} from "@/server/cookie-security";
import { getAuthSecretSync } from "@/server/settings";

export const SHARE_ACCESS_COOKIE_NAME = "staaash_share_access";

const signValue = (value: string) =>
  createHmac("sha256", getAuthSecretSync())
    .update(":share-access:")
    .update(value)
    .digest("base64url");

export const buildShareAccessFingerprint = ({
  shareId,
  tokenLookupKey,
  passwordHash,
}: {
  shareId: string;
  tokenLookupKey: string;
  passwordHash: string;
}) =>
  createHmac("sha256", getAuthSecretSync())
    .update(":share-access-fingerprint:")
    .update(shareId)
    .update(":")
    .update(tokenLookupKey)
    .update(":")
    .update(passwordHash)
    .digest("base64url");

const baseCookie = (context?: CookieRequestContext) => ({
  name: SHARE_ACCESS_COOKIE_NAME,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: resolveSecureCookie(context),
});

type ShareCookiePayload = {
  shareId: string;
  tokenLookupKey: string;
  accessFingerprint: string;
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
      typeof parsed.accessFingerprint !== "string"
    ) {
      return null;
    }

    return {
      shareId: parsed.shareId,
      tokenLookupKey: parsed.tokenLookupKey,
      accessFingerprint: parsed.accessFingerprint,
    };
  } catch {
    return null;
  }
};

export const buildShareAccessCookie = (
  {
    shareId,
    tokenLookupKey,
    accessFingerprint,
    token,
  }: ShareCookiePayload & {
    token: string;
  },
  context?: CookieRequestContext,
) => {
  const payload = serializePayload({
    shareId,
    tokenLookupKey,
    accessFingerprint,
  });

  return {
    ...baseCookie(context),
    path: `/s/${encodeURIComponent(token)}`,
    value: `${payload}.${signValue(payload)}`,
  };
};

export const buildClearedShareAccessCookie = (
  token: string,
  context?: CookieRequestContext,
) => ({
  ...baseCookie(context),
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
    payload.accessFingerprint ===
      buildShareAccessFingerprint({
        shareId,
        tokenLookupKey,
        passwordHash,
      })
  );
};
