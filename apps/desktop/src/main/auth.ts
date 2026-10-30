import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { shell } from "electron";

const TIMEOUT_MS = 10 * 60_000;

// The shared theme colours; this page cannot load the app's stylesheet.
const CONNECTED_PAGE = `<!doctype html><meta charset=utf-8><title>Staaash</title>
<style>
:root { color-scheme: light dark; background: oklch(0.968 0.0035 75); color: oklch(0.22 0.007 70); }
@media (prefers-color-scheme: dark) { :root { background: oklch(0.135 0.003 70); color: oklch(0.95 0.003 80); } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px system-ui, sans-serif; }
</style>
<body>Connected. You can close this tab.</body>`;

/**
 * Browser sign-in (RFC 8252): the app listens on a loopback port, the person
 * approves this device on the server's page, and the browser brings back a
 * one-time code. The PKCE verifier proves this app asked for it.
 */
export const signInWithBrowser = async (
  serverUrl: string,
  deviceName: string,
) => {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let finish: (code: string) => void = () => {};
  let fail: (error: Error) => void = () => {};
  const codeArrived = new Promise<string>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const listener = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const code = url.searchParams.get("code");
    if (url.pathname !== "/callback" || !code) {
      response.writeHead(404).end();
      return;
    }
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(CONNECTED_PAGE);
    finish(code);
  });
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const timer = setTimeout(
    () => fail(new Error("Sign-in timed out. Try again.")),
    TIMEOUT_MS,
  );
  try {
    const { port } = listener.address() as AddressInfo;
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const approve = new URL("/auth/device", serverUrl);
    approve.searchParams.set("redirect_uri", redirectUri);
    approve.searchParams.set("code_challenge", challenge);
    approve.searchParams.set("code_challenge_method", "S256");
    approve.searchParams.set("device_name", deviceName);
    await shell.openExternal(approve.toString());
    const code = await codeArrived;
    const response = await fetch(new URL("/api/auth/device/token", serverUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, codeVerifier: verifier, redirectUri }),
    });
    const body = (await response.json().catch(() => null)) as {
      token?: string;
      error?: string;
      session?: { user: { email: string; displayName: string | null } };
    } | null;
    if (!response.ok || !body?.token || !body.session) {
      throw new Error(body?.error ?? "Sign-in failed. Try again.");
    }
    return { token: body.token, email: body.session.user.email };
  } finally {
    clearTimeout(timer);
    listener.close();
  }
};

/** A one-time link that opens the web app in an app window, signed in. */
export const webSessionUrl = async (serverUrl: string, token: string) => {
  const response = await fetch(
    new URL("/api/auth/device/web-session", serverUrl),
    { method: "POST", headers: { authorization: `Bearer ${token}` } },
  );
  if (!response.ok)
    throw new Error(`Could not open Staaash (${response.status}).`);
  return ((await response.json()) as { url: string }).url;
};

/** Ends the device session on the server; the token stops working. */
export const signOutDevice = async (serverUrl: string, token: string) => {
  await fetch(new URL("/api/auth/sign-out", serverUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
};
