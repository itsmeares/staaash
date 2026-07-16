import { describe, expect, it } from "vitest";

import {
  getUpdateStatusDotClassName,
  getUpdateStatusLabel,
} from "@/lib/update-status";

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
});
