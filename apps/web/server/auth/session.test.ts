import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSession: vi.fn(),
  },
}));

const loadSessionModule = async ({
  nodeEnv = "test",
  secureCookies,
}: {
  nodeEnv?: "development" | "test" | "production";
  secureCookies?: boolean;
}) => {
  vi.resetModules();
  vi.doMock("@/lib/env", () => ({
    env: {
      NODE_ENV: nodeEnv,
      SECURE_COOKIES: secureCookies,
    },
  }));

  return import("@/server/auth/session");
};

const requestContext = (url: string, headers?: HeadersInit) => ({
  url,
  headers: new Headers(headers),
});

describe("auth session cookies", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/env");
  });

  it("builds a secure session cookie when SECURE_COOKIES is true", async () => {
    const { buildSessionCookie, SESSION_COOKIE_NAME } = await loadSessionModule(
      {
        secureCookies: true,
      },
    );
    const expiresAt = new Date("2026-05-11T12:00:00.000Z");

    expect(buildSessionCookie("session-token", expiresAt)).toEqual({
      name: SESSION_COOKIE_NAME,
      value: "session-token",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: expiresAt,
    });
  });

  it("builds a cleared session cookie", async () => {
    const { buildClearedSessionCookie, SESSION_COOKIE_NAME } =
      await loadSessionModule({
        secureCookies: false,
      });

    expect(buildClearedSessionCookie()).toEqual({
      name: SESSION_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      expires: new Date(0),
      maxAge: 0,
    });
  });

  it("lets SECURE_COOKIES=false override HTTPS requests", async () => {
    const { buildSessionCookie } = await loadSessionModule({
      secureCookies: false,
    });
    const expiresAt = new Date("2026-05-11T12:00:00.000Z");

    expect(
      buildSessionCookie(
        "session-token",
        expiresAt,
        requestContext("http://staaash:2113/api/auth/sign-in", {
          "x-forwarded-proto": "https",
        }),
      ),
    ).toMatchObject({
      secure: false,
    });
  });

  it("uses non-secure cookies for plain HTTP requests without an override", async () => {
    const { buildSessionCookie } = await loadSessionModule({
      nodeEnv: "production",
    });
    const expiresAt = new Date("2026-05-11T12:00:00.000Z");

    expect(
      buildSessionCookie(
        "session-token",
        expiresAt,
        requestContext("http://46.1.113.7:2113/api/auth/sign-in"),
      ),
    ).toMatchObject({
      secure: false,
    });
  });

  it("uses secure cookies for forwarded HTTPS requests without an override", async () => {
    const { buildOnboardedCookie, ONBOARDED_COOKIE_NAME } =
      await loadSessionModule({
        nodeEnv: "production",
      });

    expect(
      buildOnboardedCookie(
        requestContext("http://staaash:2113/api/auth/rehydrate", {
          "x-forwarded-proto": "https",
        }),
      ),
    ).toEqual({
      name: ONBOARDED_COOKIE_NAME,
      value: "1",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
  });

  it("falls back to secure cookies in production when no request is passed", async () => {
    const { buildOnboardedCookie } = await loadSessionModule({
      nodeEnv: "production",
    });

    expect(buildOnboardedCookie()).toMatchObject({
      secure: true,
    });
  });

  it("builds cleared onboarded and theme cookies", async () => {
    const {
      buildClearedOnboardedCookie,
      buildThemeCookie,
      ONBOARDED_COOKIE_NAME,
      THEME_COOKIE_NAME,
    } = await loadSessionModule({
      secureCookies: false,
    });

    expect(buildClearedOnboardedCookie()).toEqual({
      name: ONBOARDED_COOKIE_NAME,
      value: "",
      secure: false,
      expires: new Date(0),
      maxAge: 0,
      path: "/",
    });
    expect(buildThemeCookie("dark")).toEqual({
      name: THEME_COOKIE_NAME,
      value: "dark",
      httpOnly: false,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 60 * 60 * 24 * 365 * 10,
    });
  });
});
