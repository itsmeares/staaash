import { describe, expect, it, vi } from "vite-plus/test";

const getSession = vi.fn();

vi.mock("@/server/auth/service", () => ({
  authService: { getSession },
}));

const { getRequestSession } = await import("@/server/auth/guards");

describe("getRequestSession", () => {
  it("hides sessions that have not finished onboarding", async () => {
    getSession.mockResolvedValueOnce({ user: { preferences: null } });

    await expect(getRequestSession("session-token")).resolves.toBe(null);
    expect(getSession).toHaveBeenCalledWith("session-token");
  });

  it("hides sessions that still owe a new password", async () => {
    getSession.mockResolvedValueOnce({
      user: {
        passwordChangeRequiredAt: new Date("2026-05-30T00:00:00.000Z"),
        preferences: { onboardingCompletedAt: new Date("2026-05-30") },
      },
    });

    await expect(getRequestSession("session-token")).resolves.toBe(null);
  });

  it("returns onboarded sessions", async () => {
    const session = {
      user: {
        passwordChangeRequiredAt: null,
        preferences: { onboardingCompletedAt: new Date("2026-05-30") },
      },
    };
    getSession.mockResolvedValueOnce(session);

    await expect(getRequestSession("session-token")).resolves.toBe(session);
  });
});
