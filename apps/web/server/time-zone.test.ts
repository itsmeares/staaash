import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  instanceTimeZone: "Europe/Berlin",
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (mocks.cookie ? { value: mocks.cookie } : undefined),
  }),
}));

vi.mock("@/server/settings", () => ({
  getSystemSettings: async () => ({ timeZone: mocks.instanceTimeZone }),
}));

const { resolveDisplayTimeZone } = await import("@/server/time-zone");

const user = (timeZone: string) => ({
  preferences: {
    enableVersionChecks: true,
    onboardingCompletedAt: null,
    showUpdateNotifications: true,
    theme: "system",
    timeZone,
  },
});

describe("resolveDisplayTimeZone", () => {
  beforeEach(() => {
    mocks.cookie = undefined;
    mocks.instanceTimeZone = "Europe/Berlin";
  });

  it("uses a fixed user preference without auto-detecting", async () => {
    mocks.cookie = "Asia/Tokyo";
    await expect(
      resolveDisplayTimeZone(user("America/New_York")),
    ).resolves.toEqual({ timeZone: "America/New_York", autoDetect: false });
  });

  it("uses the browser cookie for automatic users and visitors", async () => {
    mocks.cookie = "Asia/Tokyo";
    const expected = { timeZone: "Asia/Tokyo", autoDetect: true };

    await expect(resolveDisplayTimeZone(user("auto"))).resolves.toEqual(
      expected,
    );
    await expect(resolveDisplayTimeZone(null)).resolves.toEqual(expected);
  });

  it("falls back to the instance zone, then UTC", async () => {
    mocks.cookie = "Not/AZone";
    await expect(resolveDisplayTimeZone(user("auto"))).resolves.toEqual({
      timeZone: "Europe/Berlin",
      autoDetect: true,
    });

    mocks.instanceTimeZone = "";
    await expect(resolveDisplayTimeZone(undefined)).resolves.toEqual({
      timeZone: "UTC",
      autoDetect: true,
    });
  });
});
