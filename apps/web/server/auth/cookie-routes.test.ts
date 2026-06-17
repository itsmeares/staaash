import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { bootstrap, getSession, revokeSession, savePreferences, signIn } =
  vi.hoisted(() => ({
    bootstrap: vi.fn(),
    getSession: vi.fn(),
    revokeSession: vi.fn(),
    savePreferences: vi.fn(),
    signIn: vi.fn(),
  }));

vi.mock("@/server/auth/service", () => ({
  authService: {
    bootstrap,
    getSession,
    revokeSession,
    savePreferences,
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
  const user = makeAuthUser(preferences);

  return {
    sessionToken,
    user,
    session: makeSession(user),
  };
};

const makeAuthUser = (preferences: unknown = null) => ({
  id: "user-1",
  email: "owner@example.com",
  storageId: "owner",
  displayName: "Owner",
  avatarUrl: null,
  isOwner: true,
  isAdmin: true,
  role: "owner",
  passwordChangeRequiredAt: null,
  temporaryPasswordIssuedAt: null,
  temporaryPasswordIssuedByUserId: null,
  storageLimitBytes: null,
  preferences,
  createdAt: new Date("2026-05-10T12:00:00.000Z"),
  updatedAt: new Date("2026-05-10T12:00:00.000Z"),
});

const makeSession = (user = makeAuthUser(completedPreferences)) => ({
  id: "session-1",
  expiresAt,
  userAgent: null,
  ipAddress: null,
  lastSeenAt: new Date("2026-05-10T12:00:00.000Z"),
  createdAt: new Date("2026-05-10T12:00:00.000Z"),
  updatedAt: new Date("2026-05-10T12:00:00.000Z"),
  user,
});

const completedSession = (theme = "dark") =>
  makeSession(
    makeAuthUser({
      ...completedPreferences,
      theme,
    }),
  );

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

const httpJsonRequest = (path: string, body: Record<string, string>) =>
  jsonRequest(`http://46.1.113.7:2113${path}`, body);

const forwardedHttpsJsonRequest = (
  path: string,
  body: Record<string, string>,
) =>
  jsonRequest(`http://staaash:2113${path}`, body, {
    host: "staaash.example.com",
    "x-forwarded-proto": "https",
  });

const request = (
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) =>
  new NextRequest(url, {
    ...init,
    headers: {
      host: new URL(url).host,
      ...init?.headers,
    },
  });

const httpRequest = (
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) => request(`http://46.1.113.7:2113${path}`, init);

const forwardedHttpsRequest = (
  path: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
) =>
  request(`http://staaash:2113${path}`, {
    ...init,
    headers: {
      host: "staaash.example.com",
      "x-forwarded-proto": "https",
      ...init?.headers,
    },
  });

const expectCookieSecure = (setCookie: string, expected: boolean) => {
  if (expected) {
    expect(setCookie).toContain("Secure");
  } else {
    expect(setCookie).not.toContain("Secure");
  }
};

describe("auth cookie routes", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("sets non-secure setup cookies over plain HTTP", async () => {
    bootstrap.mockResolvedValueOnce(makeAuthResult("setup-token"));
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      httpJsonRequest("/api/auth/setup", {
        instanceName: "Home Drive",
        email: "owner@example.com",
        password: "super-secure-password",
      }),
    );

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=setup-token");
    expectCookieSecure(setCookie, false);
  });

  it("sets secure setup cookies behind forwarded HTTPS", async () => {
    bootstrap.mockResolvedValueOnce(makeAuthResult("setup-token"));
    const { POST } = await import("@/app/api/auth/setup/route");

    const response = await POST(
      forwardedHttpsJsonRequest("/api/auth/setup", {
        instanceName: "Home Drive",
        email: "owner@example.com",
        password: "super-secure-password",
      }),
    );

    expect(response.status).toBe(201);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=setup-token");
    expectCookieSecure(setCookie, true);
  });

  it("sets non-secure sign-in cookies over plain HTTP", async () => {
    signIn.mockResolvedValueOnce(
      makeAuthResult("sign-in-token", completedPreferences),
    );
    const { POST } = await import("@/app/api/auth/sign-in/route");

    const response = await POST(
      httpJsonRequest("/api/auth/sign-in", {
        email: "owner@example.com",
        password: "super-secure-password",
      }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=sign-in-token");
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=dark");
    expectCookieSecure(setCookie, false);
  });

  it("sets secure sign-in cookies behind forwarded HTTPS", async () => {
    signIn.mockResolvedValueOnce(
      makeAuthResult("sign-in-token", completedPreferences),
    );
    const { POST } = await import("@/app/api/auth/sign-in/route");

    const response = await POST(
      forwardedHttpsJsonRequest("/api/auth/sign-in", {
        email: "owner@example.com",
        password: "super-secure-password",
      }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=sign-in-token");
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=dark");
    expectCookieSecure(setCookie, true);
  });

  it("sets non-secure rehydrate cookies over plain HTTP", async () => {
    getSession.mockResolvedValueOnce(completedSession());
    const { GET } = await import("@/app/api/auth/rehydrate/route");

    const response = await GET(
      httpRequest("/api/auth/rehydrate", {
        headers: {
          cookie: "staaash_session=session-token",
        },
      }),
    );

    expect(response.status).toBe(307);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=dark");
    expectCookieSecure(setCookie, false);
  });

  it("sets secure rehydrate cookies behind forwarded HTTPS", async () => {
    getSession.mockResolvedValueOnce(completedSession());
    const { GET } = await import("@/app/api/auth/rehydrate/route");

    const response = await GET(
      forwardedHttpsRequest("/api/auth/rehydrate", {
        headers: {
          cookie: "staaash_session=session-token",
        },
      }),
    );

    expect(response.status).toBe(307);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=dark");
    expectCookieSecure(setCookie, true);
  });

  it("sets non-secure preference cookies over plain HTTP", async () => {
    getSession.mockResolvedValueOnce(completedSession("system"));
    savePreferences.mockResolvedValueOnce(completedPreferences);
    const { POST } = await import("@/app/api/user/preferences/route");

    const response = await POST(
      httpJsonRequest("/api/user/preferences", {
        theme: "light",
        timeZone: "UTC",
      }),
    );

    expect(response.status).toBe(200);
    expect(savePreferences).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        theme: "light",
        timeZone: "UTC",
      }),
    );
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=light");
    expectCookieSecure(setCookie, false);
  });

  it("sets secure preference cookies behind forwarded HTTPS", async () => {
    getSession.mockResolvedValueOnce(completedSession("system"));
    savePreferences.mockResolvedValueOnce(completedPreferences);
    const { POST } = await import("@/app/api/user/preferences/route");

    const response = await POST(
      forwardedHttpsJsonRequest("/api/user/preferences", {
        theme: "light",
        timeZone: "UTC",
      }),
    );

    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_onboarded=1");
    expect(setCookie).toContain("staaash_theme=light");
    expectCookieSecure(setCookie, true);
  });

  it("sets secure cleared session cookies behind forwarded HTTPS", async () => {
    revokeSession.mockResolvedValueOnce(undefined);
    const { DELETE } = await import("@/app/api/auth/session/route");

    const response = await DELETE(
      forwardedHttpsRequest("/api/auth/session", {
        method: "DELETE",
        headers: {
          cookie: "staaash_session=session-token",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledWith("session-token");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("staaash_session=");
    expect(setCookie).toContain("Max-Age=0");
    expectCookieSecure(setCookie, true);
  });
});
