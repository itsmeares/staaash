import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSession = vi.fn();
const getSetupState = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
const pushMock = vi.fn();

vi.mock("@/server/auth/session", () => ({
  getCurrentSession,
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSetupState,
  },
}));

vi.mock("next/navigation", () => ({
  redirect,
  useRouter: () => ({ push: pushMock }),
}));

describe("HomePage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const searchParams = Promise.resolve({});

  it("renders the setup entry state for an unbootstrapped instance", async () => {
    getCurrentSession.mockResolvedValue(null);
    getSetupState.mockResolvedValue({
      isBootstrapped: false,
      instanceName: null,
    });

    const { default: HomePage } = await import("@/app/page");
    const page = await HomePage({ searchParams });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Bring your Staaash");
  });

  it("redirects signed-in visitors with completed onboarding to the library", async () => {
    getCurrentSession.mockResolvedValue({
      user: { preferences: { onboardingCompletedAt: new Date() } },
    });
    getSetupState.mockResolvedValue({ isBootstrapped: true });

    const { default: HomePage } = await import("@/app/page");

    await expect(HomePage({ searchParams })).rejects.toThrow(
      "redirect:/api/auth/rehydrate",
    );
    expect(redirect).toHaveBeenCalledWith("/api/auth/rehydrate");
  });

  const firstRun = async (user: Record<string, unknown>) => {
    getCurrentSession.mockResolvedValue({ user });
    getSetupState.mockResolvedValue({
      isBootstrapped: true,
      instanceName: "Test",
    });
    const { default: HomePage } = await import("@/app/page");
    return renderToStaticMarkup(await HomePage({ searchParams }));
  };

  it("welcomes a new member to their account on this drive", async () => {
    expect(await firstRun({ preferences: null, isOwner: false })).toContain(
      "Test account.",
    );
  });

  it("starts an owner who already made the account at the look step", async () => {
    expect(await firstRun({ preferences: null, isOwner: true })).toContain(
      "Choose a look",
    );
  });

  it("asks only for a new password after an owner reset it", async () => {
    expect(
      await firstRun({
        preferences: { onboardingCompletedAt: new Date() },
        passwordChangeRequiredAt: new Date(),
        isOwner: false,
      }),
    ).toContain("Choose a new password");
  });
});
