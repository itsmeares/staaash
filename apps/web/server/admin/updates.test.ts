import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@staaash/db/instance", () => ({
  readInstanceUpdateCheck: vi.fn(),
}));

vi.mock("@/server/app-version", () => ({
  resolveAppVersion: () => "2.0.0",
}));

vi.mock("@/server/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/settings")>()),
  getSystemSettings: vi.fn(),
}));

const { readInstanceUpdateCheck } = await import("@staaash/db/instance");
const { getSystemSettings } = await import("@/server/settings");

import type { InstanceUpdateCheckState } from "@staaash/db/instance";
import { getAdminUpdateStatus } from "@/server/admin/updates";

const STALE_UPDATE_ROW: InstanceUpdateCheckState = {
  lastUpdateCheckAt: new Date("2026-03-01T00:00:00.000Z"),
  updateCheckStatus: "update-available",
  updateCheckMessage: "Update available: 2.0.0.",
  latestAvailableVersion: "2.0.0",
  checkedVersion: "1.0.0",
};

type SettingsRow = Awaited<ReturnType<typeof getSystemSettings>>;

const SETTINGS: SettingsRow = {
  updateCheckRepository: "itsmeares/staaash",
} as SettingsRow;

describe("getAdminUpdateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettings).mockResolvedValue(SETTINGS);
    vi.mocked(readInstanceUpdateCheck).mockResolvedValue(STALE_UPDATE_ROW);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(["production", "test"])(
    "uses the resolved app version in %s",
    async (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      const status = await getAdminUpdateStatus();

      expect(status).toMatchObject({
        currentVersion: "2.0.0",
        updateCheckStatus: null,
        updateCheckMessage:
          "Update check was run against v1.0.0; re-run to refresh.",
        latestAvailableVersion: null,
      });
      expect(status).not.toHaveProperty("checkedVersion");
    },
  );

  it("preserves a result checked by the running version", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(readInstanceUpdateCheck).mockResolvedValue({
      ...STALE_UPDATE_ROW,
      updateCheckMessage: "Update available: 3.0.0.",
      latestAvailableVersion: "3.0.0",
      checkedVersion: "2.0.0",
    });

    await expect(getAdminUpdateStatus()).resolves.toMatchObject({
      currentVersion: "2.0.0",
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available: 3.0.0.",
      latestAvailableVersion: "3.0.0",
    });
  });
});
