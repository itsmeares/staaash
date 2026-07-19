import { afterEach, describe, expect, it, vi } from "vitest";

const loadAccessCookieModule = async ({
  nodeEnv = "test",
  secureCookies,
}: {
  nodeEnv?: "development" | "test" | "production";
  secureCookies?: boolean;
} = {}) => {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      NODE_ENV: nodeEnv,
      SECURE_COOKIES: secureCookies,
    },
  }));

  return import("@/server/sharing/access-cookie");
};

const requestContext = (url: string, headers?: HeadersInit) => ({
  url,
  headers: new Headers(headers),
});

describe("share access cookies", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/env");
  });

  it("verifies cookies against the current share fingerprint without storing the hash", async () => {
    const {
      buildShareAccessCookie,
      buildShareAccessFingerprint,
      verifyShareAccessCookie,
    } = await loadAccessCookieModule();
    const cookie = buildShareAccessCookie({
      shareId: "share-1",
      tokenLookupKey: "lookup-1",
      accessFingerprint: buildShareAccessFingerprint({
        shareId: "share-1",
        tokenLookupKey: "lookup-1",
        passwordHash: "hash:v1",
      }),
      token: "lookup-1.signature",
    });
    const [payload] = cookie.value.split(".");
    const decodedPayload = Buffer.from(payload, "base64url").toString("utf8");

    expect(
      verifyShareAccessCookie({
        cookieValue: cookie.value,
        shareId: "share-1",
        tokenLookupKey: "lookup-1",
        passwordHash: "hash:v1",
      }),
    ).toBe(true);
    expect(
      verifyShareAccessCookie({
        cookieValue: cookie.value,
        shareId: "share-1",
        tokenLookupKey: "lookup-1",
        passwordHash: "hash:v2",
      }),
    ).toBe(false);
    expect(decodedPayload).not.toContain("hash:v1");
    expect(decodedPayload).toContain("accessFingerprint");
  });

  it("uses non-secure cookies for production plain HTTP without an override", async () => {
    const { buildShareAccessCookie } = await loadAccessCookieModule({
      nodeEnv: "production",
    });

    expect(
      buildShareAccessCookie(
        {
          shareId: "share-1",
          tokenLookupKey: "lookup-1",
          accessFingerprint: "fingerprint-1",
          token: "lookup-1.signature",
        },
        requestContext("http://46.1.113.7:2113/s/lookup-1.signature/unlock"),
      ),
    ).toMatchObject({ secure: false });
  });

  it("uses secure cookies for production forwarded HTTPS without an override", async () => {
    const { buildShareAccessCookie } = await loadAccessCookieModule({
      nodeEnv: "production",
    });

    expect(
      buildShareAccessCookie(
        {
          shareId: "share-1",
          tokenLookupKey: "lookup-1",
          accessFingerprint: "fingerprint-1",
          token: "lookup-1.signature",
        },
        requestContext("http://staaash:2113/s/lookup-1.signature/unlock", {
          "x-forwarded-proto": "https",
        }),
      ),
    ).toMatchObject({ secure: true });
  });

  it("lets SECURE_COOKIES=true override plain HTTP requests", async () => {
    const { buildShareAccessCookie } = await loadAccessCookieModule({
      nodeEnv: "production",
      secureCookies: true,
    });

    expect(
      buildShareAccessCookie(
        {
          shareId: "share-1",
          tokenLookupKey: "lookup-1",
          accessFingerprint: "fingerprint-1",
          token: "lookup-1.signature",
        },
        requestContext("http://46.1.113.7:2113/s/lookup-1.signature/unlock"),
      ),
    ).toMatchObject({ secure: true });
  });

  it("lets SECURE_COOKIES=false override forwarded HTTPS requests", async () => {
    const { buildShareAccessCookie } = await loadAccessCookieModule({
      nodeEnv: "production",
      secureCookies: false,
    });

    expect(
      buildShareAccessCookie(
        {
          shareId: "share-1",
          tokenLookupKey: "lookup-1",
          accessFingerprint: "fingerprint-1",
          token: "lookup-1.signature",
        },
        requestContext("http://staaash:2113/s/lookup-1.signature/unlock", {
          "x-forwarded-proto": "https",
        }),
      ),
    ).toMatchObject({ secure: false });
  });

  it("clears the scoped cookie with the same request-aware policy", async () => {
    const { buildClearedShareAccessCookie } = await loadAccessCookieModule({
      nodeEnv: "production",
    });
    const directHttpCookie = buildClearedShareAccessCookie(
      "lookup-1.signature",
      requestContext("http://46.1.113.7:2113/s/lookup-1.signature"),
    );
    const forwardedHttpsCookie = buildClearedShareAccessCookie(
      "lookup-1.signature",
      requestContext("http://staaash:2113/s/lookup-1.signature", {
        "x-forwarded-proto": "https",
      }),
    );

    expect(directHttpCookie).toMatchObject({
      maxAge: 0,
      path: "/s/lookup-1.signature",
      secure: false,
    });
    expect(forwardedHttpsCookie).toMatchObject({ secure: true });
  });

  it("keeps the secure production fallback without request context", async () => {
    const { buildClearedShareAccessCookie } = await loadAccessCookieModule({
      nodeEnv: "production",
    });

    expect(buildClearedShareAccessCookie("lookup-1.signature")).toMatchObject({
      secure: true,
    });
  });
});
