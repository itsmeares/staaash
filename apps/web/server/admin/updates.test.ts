import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@staaash/db/instance", () => ({
  readInstanceUpdateCheck: vi.fn(),
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
  updateCheckMessage: "Update available: 1.0.0.",
  latestAvailableVersion: "1.0.0",
};

type SettingsRow = Awaited<ReturnType<typeof getSystemSettings>>;

const SETTINGS: SettingsRow = {
  updateCheckRepository: "itsmeares/staaash",
} as SettingsRow;

describe("getAdminUpdateStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSystemSettings).mockResolvedValue(SETTINGS);
  });

  it("returns a development version and passes the row through in non-production", async () => {
    vi.mocked(readInstanceUpdateCheck).mockResolvedValue(STALE_UPDATE_ROW);

    const status = await getAdminUpdateStatus();

    expect(status.currentVersion).toBe("development");
    expect(status.updateCheckStatus).toBe("update-available");
    expect(status.updateCheckMessage).toBe("Update available: 1.0.0.");
  });

  it("derives up-to-date when the packaged version equals latest in production", async () => {
    vi.mocked(readInstanceUpdateCheck).mockResolvedValue(STALE_UPDATE_ROW);

    const status = await getAdminUpdateStatus();

    if (process.env.NODE_ENV === "production") {
      expect(status.currentVersion).toBe("1.0.0");
      expect(status.updateCheckStatus).toBe("up-to-date");
      expect(status.updateCheckMessage).toBe(
        "Instance is on or ahead of the latest published release (v1.0.0).",
      );
    } else {
      expect(status.updateCheckStatus).toBe("update-available");
    }
  });

  it("keeps a genuinely newer release as update-available in production", async () => {
    vi.mocked(readInstanceUpdateCheck).mockResolvedValue({
      ...STALE_UPDATE_ROW,
      updateCheckMessage: "Update available: 2.0.0.",
      latestAvailableVersion: "2.0.0",
    });

    const status = await getAdminUpdateStatus();

    if (process.env.NODE_ENV === "production") {
      expect(status.currentVersion).toBe("1.0.0");
      expect(status.updateCheckStatus).toBe("update-available");
      expect(status.updateCheckMessage).toBe("Update available: 2.0.0.");
    } else {
      expect(status.updateCheckStatus).toBe("update-available");
    }
  });
});
