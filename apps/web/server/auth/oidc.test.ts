import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import type { OidcEnv } from "@/lib/env";
import { finishOidc, startOidc } from "@/server/auth/oidc";

const SECRET = "test-auth-secret";

/**
 * A tiny OIDC provider: discovery, an authorize endpoint that signs the
 * person in at once, and a token endpoint that checks PKCE and signs an RS256
 * ID token. Enough for openid-client to run every real check.
 */
const startProvider = async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig" };
  const pending = new Map<
    string,
    { nonce: string; challenge: string; redirectUri: string }
  >();
  const person = {
    sub: "sub-1",
    email: "partner@example.com",
    name: "Partner",
    groups: ["family"],
  };
  let issuer = "";

  const jwt = (claims: object) => {
    const encode = (part: object) =>
      Buffer.from(JSON.stringify(part)).toString("base64url");
    const body = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode(claims)}`;
    return `${body}.${sign("sha256", Buffer.from(body), privateKey).toString("base64url")}`;
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url!, issuer);
    const json = (status: number, body: object) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        userinfo_endpoint: `${issuer}/userinfo`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
    if (url.pathname === "/authorize") {
      const code = `code-${pending.size + 1}`;
      pending.set(code, {
        nonce: url.searchParams.get("nonce")!,
        challenge: url.searchParams.get("code_challenge")!,
        redirectUri: url.searchParams.get("redirect_uri")!,
      });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      res.writeHead(302, { location: back.href });
      return res.end();
    }
    if (url.pathname === "/token") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const grant = pending.get(form.get("code") ?? "");
      pending.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256")
        .update(verifier)
        .digest("base64url");
      if (
        !grant ||
        grant.challenge !== challenge ||
        grant.redirectUri !== form.get("redirect_uri")
      ) {
        return json(400, { error: "invalid_grant" });
      }
      const now = Math.floor(Date.now() / 1000);
      return json(200, {
        access_token: "access-token",
        token_type: "Bearer",
        expires_in: 300,
        id_token: jwt({
          iss: issuer,
          sub: person.sub,
          aud: form.get("client_id"),
          iat: now,
          exp: now + 300,
          nonce: grant.nonce,
        }),
      });
    }
    if (url.pathname === "/userinfo") {
      // Like Authelia: email and groups only here, not in the ID token.
      return req.headers.authorization === "Bearer access-token"
        ? json(200, person)
        : json(401, { error: "invalid_token" });
    }
    json(404, {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  issuer = `http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`;
  return { issuer, person, close: () => server.close() };
};

let provider: Awaited<ReturnType<typeof startProvider>>;
let oidc: OidcEnv;

beforeAll(async () => {
  provider = await startProvider();
  oidc = {
    issuer: provider.issuer,
    clientId: "staaash",
    clientSecret: null,
    providerName: "Pocket ID",
    autoRegister: false,
    defaultStorageLimitBytes: null,
    adminGroup: "family",
    passwordLogin: true,
    startUrl: "https://drive.example.com/api/auth/oidc/start",
    callbackUrl: "https://drive.example.com/api/auth/oidc/callback",
  };
});

afterAll(() => provider.close());

/** Off to the provider and back: the query string it sends to the callback. */
const signInAtProvider = async (url: string) => {
  const response = await fetch(url, { redirect: "manual" });
  const back = new URL(response.headers.get("location")!);
  expect(`${back.origin}${back.pathname}`).toBe(oidc.callbackUrl);
  return back.search;
};

const start = (options: Partial<Parameters<typeof startOidc>[2]> = {}) =>
  startOidc(oidc, SECRET, {
    next: null,
    connectUserId: null,
    invite: null,
    ...options,
  });

describe("single sign-on trip", () => {
  it("comes back with who signed in and where to go next", async () => {
    const { url, cookie } = await start({ next: "/auth/device?port=4000" });

    expect(new URL(url).searchParams.get("scope")).toBe(
      "openid profile email groups",
    );
    const { identity, flow } = await finishOidc(
      oidc,
      SECRET,
      cookie,
      await signInAtProvider(url),
    );

    expect(identity).toEqual({
      issuer: provider.issuer,
      subject: "sub-1",
      email: "partner@example.com",
      name: "Partner",
      groups: ["family"],
    });
    expect(flow.next).toBe("/auth/device?port=4000");
  });

  it("rejects a cookie that was changed or is too old", async () => {
    const { url, cookie } = await start();
    const search = await signInAtProvider(url);
    const [payload, signature] = cookie.split(".");
    const flow = JSON.parse(Buffer.from(payload!, "base64url").toString());
    const forged = `${Buffer.from(
      JSON.stringify({ ...flow, connectUserId: "victim" }),
    ).toString("base64url")}.${signature}`;

    await expect(
      finishOidc(oidc, SECRET, forged, search),
    ).rejects.toMatchObject({ code: "OIDC_FAILED" });
    await expect(
      finishOidc(oidc, SECRET, cookie, search, Date.now() + 11 * 60_000),
    ).rejects.toMatchObject({ code: "OIDC_FAILED" });
    await expect(
      finishOidc(oidc, SECRET, undefined, search),
    ).rejects.toMatchObject({ code: "OIDC_FAILED" });
  });

  it("rejects an answer meant for another sign-in", async () => {
    const mine = await start();
    const theirs = await start();
    const theirSearch = await signInAtProvider(theirs.url);

    await expect(
      finishOidc(oidc, SECRET, mine.cookie, theirSearch),
    ).rejects.toMatchObject({ code: "OIDC_FAILED" });
  });

  it("fails while the provider is down and works once it is back", async () => {
    const down = { ...oidc, issuer: "http://127.0.0.1:9", clientId: "down" };

    await expect(
      startOidc(down, SECRET, {
        next: null,
        connectUserId: null,
        invite: null,
      }),
    ).rejects.toThrow();
    await expect(start()).resolves.toHaveProperty("url");
  });
});
