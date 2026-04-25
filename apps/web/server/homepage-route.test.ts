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

    expect(markup).toContain("Bring your Staaash online.");
    expect(markup).toContain(
      "Create the first owner account. After this, your instance is private and invite-only.",
    );
  });

  it("redirects signed-in visitors with completed onboarding to the library", async () => {
    getCurrentSession.mockResolvedValue({
      user: { preferences: { onboardingCompletedAt: new Date() } },
    });
    getSetupState.mockResolvedValue({ isBootstrapped: true });

    const { default: HomePage } = await import("@/app/page");

    await expect(HomePage({ searchParams })).rejects.toThrow("redirect:/files");
    expect(redirect).toHaveBeenCalledWith("/files");
  });

  it("renders onboarding for signed-in visitors without completed onboarding", async () => {
    getCurrentSession.mockResolvedValue({
      user: { preferences: null },
    });
    getSetupState.mockResolvedValue({
      isBootstrapped: true,
      instanceName: "Test",
    });

    const { default: HomePage } = await import("@/app/page");
    const page = await HomePage({ searchParams });
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("A few things before you begin.");
  });
});
