import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unlockShare: vi.fn(),
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    unlockShare: mocks.unlockShare,
  },
}));

const loadUnlockRoute = async () => {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      NODE_ENV: "production",
      SECURE_COOKIES: undefined,
    },
  }));

  return import("@/app/s/[token]/unlock/route");
};

const unlockResult = {
  share: {
    id: "share-1",
    tokenLookupKey: "lookup-1",
  },
  accessFingerprint: "fingerprint-1",
};

const jsonRequest = (url: string, headers: Record<string, string>) =>
  new NextRequest(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ password: "secret-pass" }),
  });

const expectCookieSecure = (setCookie: string, expected: boolean) => {
  if (expected) {
    expect(setCookie).toContain("Secure");
  } else {
    expect(setCookie).not.toContain("Secure");
  }
};

describe("share unlock route cookies", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock("@/lib/env");
  });

  it("sets a non-secure share-access cookie over production plain HTTP", async () => {
    mocks.unlockShare.mockResolvedValueOnce(unlockResult);
    const { POST } = await loadUnlockRoute();
    const response = await POST(
      jsonRequest("http://46.1.113.7:2113/s/lookup-1.signature/unlock", {
        host: "46.1.113.7:2113",
        origin: "http://46.1.113.7:2113",
      }),
      { params: Promise.resolve({ token: "lookup-1.signature" }) },
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_share_access=");
    expect(setCookie).toContain("Path=/s/lookup-1.signature");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=lax");
    expectCookieSecure(setCookie, false);
  });

  it("sets a secure share-access cookie over production forwarded HTTPS", async () => {
    mocks.unlockShare.mockResolvedValueOnce(unlockResult);
    const { POST } = await loadUnlockRoute();
    const response = await POST(
      jsonRequest("http://staaash:2113/s/lookup-1.signature/unlock", {
        host: "staaash.example.com",
        origin: "https://staaash.example.com",
        "x-forwarded-proto": "https",
      }),
      { params: Promise.resolve({ token: "lookup-1.signature" }) },
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_share_access=");
    expectCookieSecure(setCookie, true);
  });
});
