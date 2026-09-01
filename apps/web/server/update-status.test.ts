import { describe, expect, it } from "vitest";

import type { UpdateCheckStatus } from "@staaash/db/instance";

import {
  getUpdateStatusDotClassName,
  getUpdateStatusLabel,
} from "@/lib/update-status";
import { deriveEffectiveUpdateStatus } from "@/server/update-derive";

const withStatus = (status: UpdateCheckStatus | null) => ({
  currentVersion: "1.0.0",
  persisted: {
    updateCheckStatus: status,
    updateCheckMessage: null,
    latestAvailableVersion: "1.0.0",
    checkedVersion: "1.0.0",
  },
});

describe("update status display", () => {
  it("formats every persisted update state explicitly", () => {
    expect(getUpdateStatusLabel("up-to-date")).toBe("Up to date");
    expect(getUpdateStatusLabel("update-available", "v1.0.1")).toBe(
      "v1.0.1 available",
    );
    expect(getUpdateStatusLabel("unavailable")).toBe("Unavailable");
    expect(getUpdateStatusLabel("error")).toBe("Check failed");
    expect(getUpdateStatusLabel(null)).toBe("Not checked");
  });

  it("uses neutral dots for unavailable and unchecked states", () => {
    expect(getUpdateStatusDotClassName("unavailable")).toContain("--muted");
    expect(getUpdateStatusDotClassName(null)).toContain("--muted");
  });

  it("maps a derived update to the update dot and label", () => {
    const derived = deriveEffectiveUpdateStatus(withStatus("update-available"));

    expect(derived.updateCheckStatus).toBe("update-available");
    expect(
      getUpdateStatusLabel(
        derived.updateCheckStatus,
        derived.latestAvailableVersion,
      ),
    ).toBe("v1.0.0 available");
    expect(getUpdateStatusDotClassName(derived.updateCheckStatus)).toBe(
      "instance-dot instance-dot--update",
    );
  });

  it("maps a non-flippable status through the dot mapper unchanged", () => {
    const derived = deriveEffectiveUpdateStatus(withStatus("error"));

    expect(derived.updateCheckStatus).toBe("error");
    expect(getUpdateStatusDotClassName(derived.updateCheckStatus)).toBe(
      "instance-dot instance-dot--error",
    );
  });
});
