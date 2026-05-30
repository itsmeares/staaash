import { describe, expect, it, vi } from "vitest";

const getCurrentSession = vi.fn();
const getSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});

vi.mock("@/server/auth/session", () => ({
  getCurrentSession,
  getSessionTokenFromCookieStore: (cookieStore: {
    get(name: string): { value: string } | undefined;
  }) => cookieStore.get("staaash_session")?.value ?? null,
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSession,
  },
}));

vi.mock("next/navigation", () => ({
  redirect,
}));

const completedSession = {
  user: {
    preferences: {
      onboardingCompletedAt: new Date("2026-05-30T00:00:00.000Z"),
    },
  },
};

const pendingSession = {
  user: {
    preferences: null,
  },
};

const cookieRequest = (value: string) => ({
  cookies: {
    get: (name: string) => (name === "staaash_session" ? { value } : undefined),
  },
});

describe("auth guards", () => {
  it("redirects signed-out page callers to the requested sign-in path", async () => {
    getCurrentSession.mockResolvedValueOnce(null);
    const { requireSignedInPageSession } = await import("@/server/auth/guards");

    await expect(requireSignedInPageSession("/?next=/files")).rejects.toThrow(
      "redirect:/?next=/files",
    );
    expect(redirect).toHaveBeenCalledWith("/?next=/files");
  });

  it("redirects signed-in page callers without completed onboarding to root", async () => {
    getCurrentSession.mockResolvedValueOnce(pendingSession);
    const { requireSignedInPageSession } = await import("@/server/auth/guards");

    await expect(requireSignedInPageSession("/?next=/files")).rejects.toThrow(
      "redirect:/",
    );
    expect(redirect).toHaveBeenCalledWith("/");
  });

  it("returns signed-in page sessions after onboarding is complete", async () => {
    getCurrentSession.mockResolvedValueOnce(completedSession);
    const { requireSignedInPageSession } = await import("@/server/auth/guards");

    await expect(requireSignedInPageSession("/?next=/files")).resolves.toBe(
      completedSession,
    );
  });

  it("hides protected API sessions without completed onboarding", async () => {
    getSession.mockResolvedValueOnce(pendingSession);
    const { getRequestSession } = await import("@/server/auth/guards");

    await expect(
      getRequestSession(cookieRequest("session-token")),
    ).resolves.toBe(null);
    expect(getSession).toHaveBeenCalledWith("session-token");
  });

  it("returns protected API sessions after onboarding is complete", async () => {
    getSession.mockResolvedValueOnce(completedSession);
    const { getRequestSession } = await import("@/server/auth/guards");

    await expect(
      getRequestSession(cookieRequest("session-token")),
    ).resolves.toBe(completedSession);
  });
});
