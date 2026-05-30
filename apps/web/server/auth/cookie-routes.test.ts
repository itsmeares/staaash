import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { bootstrap, signIn } = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  signIn: vi.fn(),
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    bootstrap,
    signIn,
  },
}));

const expiresAt = new Date("2026-05-11T12:00:00.000Z");
const completedPreferences = {
  theme: "dark",
  timeZone: "UTC",
  showUpdateNotifications: true,
  enableVersionChecks: true,
  onboardingCompletedAt: new Date("2026-05-10T12:00:00.000Z"),
};

const makeAuthResult = (sessionToken: string, preferences: unknown = null) => {
  const user = {
    id: "user-1",
    email: "owner@example.com",
    username: "owner",
    displayName: "Owner",
    avatarUrl: null,
    role: "owner",
    storageLimitBytes: null,
    preferences,
    createdAt: new Date("2026-05-10T12:00:00.000Z"),
    updatedAt: new Date("2026-05-10T12:00:00.000Z"),
  };

  return {
    sessionToken,
    user,
    session: {
      id: "session-1",
      expiresAt,
      createdAt: new Date("2026-05-10T12:00:00.000Z"),
      updatedAt: new Date("2026-05-10T12:00:00.000Z"),
      user,
    },
  };
};

const jsonRequest = (
  url: string,
  body: Record<string, string>,
  headers?: HeadersInit,
) =>
  new NextRequest(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      host: new URL(url).host,
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("auth cookie routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("sets non-secure setup cookies over plain HTTP", async () => {
    bootstrap.mockResolvedValueOnce(makeAuthResult("setup-token"));
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      jsonRequest("http://46.1.113.7:2113/api/auth/setup", {
        instanceName: "Home Drive",
        email: "owner@example.com",
        username: "owner",
        password: "super-secure-password",
      }),
    );

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=setup-token");
    expect(setCookie).not.toContain("Secure");
  });

  it("sets secure setup cookies behind forwarded HTTPS", async () => {
    bootstrap.mockResolvedValueOnce(makeAuthResult("setup-token"));
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      jsonRequest(
        "http://staaash:2113/api/auth/setup",
        {
          instanceName: "Home Drive",
          email: "owner@example.com",
          username: "owner",
          password: "super-secure-password",
        },
        {
          host: "staaash.example.com",
          "x-forwarded-proto": "https",
        },
      ),
    );

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=setup-token");
    expect(setCookie).toContain("Secure");
  });

  it("sets non-secure sign-in cookies over plain HTTP", async () => {
    signIn.mockResolvedValueOnce(
      makeAuthResult("sign-in-token", completedPreferences),
    );
    const { POST } = await import("@/app/api/auth/sign-in/route");

    const response = await POST(
      jsonRequest("http://46.1.113.7:2113/api/auth/sign-in", {
        identifier: "owner",
        password: "super-secure-password",
      }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=sign-in-token");
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=dark");
    expect(setCookie).not.toContain("Secure");
  });

  it("sets secure sign-in cookies behind forwarded HTTPS", async () => {
    signIn.mockResolvedValueOnce(
      makeAuthResult("sign-in-token", completedPreferences),
    );
    const { POST } = await import("@/app/api/auth/sign-in/route");

    const response = await POST(
      jsonRequest(
        "http://staaash:2113/api/auth/sign-in",
        {
          identifier: "owner",
          password: "super-secure-password",
        },
        {
          host: "staaash.example.com",
          "x-forwarded-proto": "https",
        },
      ),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=sign-in-token");
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=dark");
    expect(setCookie).toContain("Secure");
  });
});
