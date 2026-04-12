import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { STAAASH_BRONZE_HEX } from "@/lib/brand";

const getCurrentSession = vi.fn();
const getSetupState = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});

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
}));

describe("HomePage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the setup entry state for an unbootstrapped instance", async () => {
    getCurrentSession.mockResolvedValue(null);
    getSetupState.mockResolvedValue({ isBootstrapped: false });

    const { default: HomePage } = await import("@/app/page");
    const page = await HomePage();
    const markup = renderToStaticMarkup(page);

    expect(markup).toContain("Bring this Staaash instance online.");
    expect(markup).toContain("Set up Staaash");
    expect(markup).toContain(
      "Create the first owner account once. After that, this Staaash stays private and invite-only.",
    );
    expect(page.props.background.props.color).toBe(STAAASH_BRONZE_HEX);
  });

  it("redirects signed-in visitors to the library", async () => {
    getCurrentSession.mockResolvedValue({ userId: "user-1" });
    getSetupState.mockResolvedValue({ isBootstrapped: true });

    const { default: HomePage } = await import("@/app/page");

    await expect(HomePage()).rejects.toThrow("redirect:/library");
    expect(redirect).toHaveBeenCalledWith("/library");
  });
});
