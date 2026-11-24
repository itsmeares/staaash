import { createHmac, timingSafeEqual } from "node:crypto";

import * as client from "openid-client";

import type { OidcEnv } from "@/lib/env";
import { getPrisma } from "@staaash/db/client";

import { consumeCode, issueCode } from "./device";
import { AuthError } from "./errors";
import type { OidcIdentity } from "./types";

export const OIDC_FLOW_COOKIE_NAME = "staaash_oidc";
export const OIDC_FLOW_MAX_AGE_SECONDS = 10 * 60;
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

/** What the browser carries to the provider and back, signed so it can't be forged. */
type OidcFlow = {
  state: string;
  nonce: string;
  verifier: string;
  next: string | null;
  /** Set when a signed-in person pressed Connect. */
  connectUserId: string | null;
  invite: string | null;
  expiresAt: number;
};

const configs = new Map<string, Promise<client.Configuration>>();

/**
 * The provider's metadata, fetched on first use. A provider that is down
 * fails this sign-in only; the next attempt asks again.
 */
const providerConfig = (oidc: OidcEnv) => {
  const key = `${oidc.issuer} ${oidc.clientId}`;
  let config = configs.get(key);
  if (!config) {
    config = client
      .discovery(
        new URL(oidc.issuer),
        oidc.clientId,
        oidc.clientSecret ?? undefined,
        oidc.clientSecret ? undefined : client.None(),
        // An http:// issuer is what the owner typed, as on a home network.
        oidc.issuer.startsWith("http:")
          ? { execute: [client.allowInsecureRequests] }
          : undefined,
      )
      .catch((error: unknown) => {
        configs.delete(key);
        throw error;
      });
    configs.set(key, config);
  }
  return config;
};

const sign = (payload: string, secret: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

const sealFlow = (flow: OidcFlow, secret: string) => {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
};

const openFlow = (value: string | undefined, secret: string, now: number) => {
  const [payload = "", signature = ""] = (value ?? "").split(".");
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (
    !payload ||
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new AuthError("OIDC_FAILED");
  }
  const flow = JSON.parse(
    Buffer.from(payload, "base64url").toString(),
  ) as OidcFlow;
  if (flow.expiresAt <= now) throw new AuthError("OIDC_FAILED");
  return flow;
};

/** The provider's address to send the browser to, and the cookie that remembers the trip. */
export const startOidc = async (
  oidc: OidcEnv,
  secret: string,
  options: {
    next: string | null;
    connectUserId: string | null;
    invite: string | null;
  },
  now = Date.now(),
) => {
  const config = await providerConfig(oidc);
  const flow: OidcFlow = {
    state: client.randomState(),
    nonce: client.randomNonce(),
    verifier: client.randomPKCECodeVerifier(),
    ...options,
    expiresAt: now + OIDC_FLOW_MAX_AGE_SECONDS * 1000,
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: oidc.callbackUrl,
    scope: oidc.adminGroup
      ? "openid profile email groups"
      : "openid profile email",
    code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256",
    state: flow.state,
    nonce: flow.nonce,
  });
  return { url: url.href, cookie: sealFlow(flow, secret) };
};

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Checks the provider's answer (state, PKCE, nonce, ID token signature and
 * issuer) and returns who signed in.
 */
export const finishOidc = async (
  oidc: OidcEnv,
  secret: string,
  cookie: string | undefined,
  search: string,
  now = Date.now(),
): Promise<{ identity: OidcIdentity; flow: OidcFlow }> => {
  const flow = openFlow(cookie, secret, now);
  const config = await providerConfig(oidc);
  const tokens = await client
    .authorizationCodeGrant(config, new URL(`${oidc.callbackUrl}${search}`), {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    })
    .catch((error: unknown) => {
      console.warn("[oidc] The provider's answer was rejected.", error);
      throw new AuthError("OIDC_FAILED");
    });
  const claims = tokens.claims()!;
  // Some providers, like Authelia, keep email and groups out of the ID token.
  const info: Record<string, unknown> = config.serverMetadata()
    .userinfo_endpoint
    ? await client.fetchUserInfo(config, tokens.access_token, claims.sub)
    : {};
  const merged: Record<string, unknown> = { ...claims, ...info };
  const groups = Array.isArray(merged.groups) ? merged.groups : [];
  return {
    flow,
    identity: {
      issuer: claims.iss,
      subject: claims.sub,
      email: text(merged.email),
      name: text(merged.name) ?? text(merged.preferred_username),
      groups: groups.filter(
        (group): group is string => typeof group === "string",
      ),
    },
  };
};

/**
 * A one-time link that connects a new account to whoever opens it and signs
 * in. Making a new one replaces the old.
 */
export const issueOidcInvite = async (oidc: OidcEnv, userId: string) => {
  const { token, tokenHash } = await issueCode();
  const now = new Date();
  await getPrisma().$transaction([
    getPrisma().deviceAuthCode.updateMany({
      where: { userId, kind: "invite", usedAt: null },
      data: { usedAt: now },
    }),
    getPrisma().deviceAuthCode.create({
      data: {
        codeHash: tokenHash,
        kind: "invite",
        userId,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      },
    }),
  ]);
  const url = new URL(oidc.startUrl);
  url.searchParams.set("invite", token);
  return url.toString();
};

/** The account an invite link was made for. A used or old link fails. */
export const redeemOidcInvite = async (invite: string) =>
  (
    await consumeCode(invite, "invite").catch(() => {
      throw new AuthError("OIDC_INVITE_INVALID");
    })
  ).userId;
