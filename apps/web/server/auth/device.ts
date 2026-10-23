import { createHash } from "node:crypto";

import { getPrisma } from "@staaash/db/client";

import { authCrypto, getAuthSecret } from "@/server/auth/crypto";
import { AuthError } from "@/server/auth/errors";
import { authService } from "@/server/auth/service";
import type { SessionMetadata } from "@/server/auth/types";

const DEVICE_CODE_TTL_MS = 5 * 60_000;
const WEB_SESSION_CODE_TTL_MS = 60_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

/** A desktop app listens on its own machine; RFC 8252 loopback redirect. */
const isLoopbackRedirect = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      url.port !== "" &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
};

const s256 = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

const issueCode = async () => {
  await getAuthSecret();
  return authCrypto.issueOpaqueToken();
};

/** Consumes a code once. A second use, or a late one, fails. */
const consumeCode = async (code: string, kind: "device" | "web") => {
  await getAuthSecret();
  const codeHash = authCrypto.hashOpaqueToken(code);
  const now = new Date();
  const row = await getPrisma().deviceAuthCode.findUnique({
    where: { codeHash },
  });
  const claimed =
    row?.kind === kind &&
    (
      await getPrisma().deviceAuthCode.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      })
    ).count === 1;
  if (!row || !claimed) throw new AuthError("DEVICE_CODE_INVALID");
  return row;
};

/** The signed-in user allowed a device; send it back with a one-time code. */
export const approveDevice = async ({
  userId,
  redirectUri,
  codeChallenge,
  deviceName,
}: {
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  deviceName: string;
}) => {
  if (!isLoopbackRedirect(redirectUri)) {
    throw new AuthError("DEVICE_REQUEST_INVALID");
  }
  const { token, tokenHash } = await issueCode();
  await getPrisma().deviceAuthCode.create({
    data: {
      codeHash: tokenHash,
      kind: "device",
      userId,
      codeChallenge,
      redirectUri,
      deviceName,
      expiresAt: new Date(Date.now() + DEVICE_CODE_TTL_MS),
    },
  });
  const url = new URL(redirectUri);
  url.searchParams.set("code", token);
  return { redirectUrl: url.toString() };
};

/** The device proves it started the request (PKCE) and gets its token. */
export const exchangeDeviceCode = async (
  {
    code,
    codeVerifier,
    redirectUri,
  }: { code: string; codeVerifier: string; redirectUri: string },
  metadata: SessionMetadata,
) => {
  const row = await consumeCode(code, "device");
  if (
    row.redirectUri !== redirectUri ||
    !row.codeChallenge ||
    s256(codeVerifier) !== row.codeChallenge
  ) {
    throw new AuthError("DEVICE_CODE_INVALID");
  }
  return authService.createSession(row.userId, {
    ...metadata,
    deviceName: row.deviceName,
  });
};

/** A one-time code the device's app window trades for a browser session. */
export const issueWebSessionCode = async (device: {
  id: string;
  userId: string;
}) => {
  const { token, tokenHash } = await issueCode();
  const expiresAt = new Date(Date.now() + WEB_SESSION_CODE_TTL_MS);
  await getPrisma().deviceAuthCode.create({
    data: {
      codeHash: tokenHash,
      kind: "web",
      userId: device.userId,
      sessionId: device.id,
      expiresAt,
    },
  });
  return { code: token, expiresAt };
};

export const redeemWebSessionCode = async (
  code: string,
  metadata: SessionMetadata,
) => {
  const row = await consumeCode(code, "web");
  // The device must still be signed in when its window opens.
  const device = row.sessionId
    ? await getPrisma().session.findFirst({
        where: {
          id: row.sessionId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      })
    : null;
  if (!device) throw new AuthError("DEVICE_CODE_INVALID");
  return authService.createSession(row.userId, {
    ...metadata,
    deviceSessionId: device.id,
  });
};
