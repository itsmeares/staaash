import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "@/lib/time";

import { formatHomeExpiryTime } from "@/app/(workspace)/home/home-helpers";

describe("home dashboard helpers", () => {
  it("formats relative time labels", () => {
    const now = new Date("2026-05-16T12:00:00.000Z");

    expect(
      formatRelativeTime("2026-05-16T12:00:00.000Z", now, "UTC", "long"),
    ).toBe("Just now");
    expect(
      formatRelativeTime("2026-05-16T11:55:00.000Z", now, "UTC", "long"),
    ).toBe("5 mins ago");
    expect(
      formatRelativeTime("2026-05-16T10:00:00.000Z", now, "UTC", "long"),
    ).toBe("2 hours ago");
    expect(
      formatRelativeTime("2026-05-15T11:00:00.000Z", now, "UTC", "long"),
    ).toBe("Yesterday");
    expect(
      formatRelativeTime("2026-05-12T12:00:00.000Z", now, "UTC", "long"),
    ).toBe("4 days ago");
  });

  it("formats future expiry labels", () => {
    const now = new Date("2026-05-16T12:00:00.000Z");

    expect(formatHomeExpiryTime("2026-05-16T12:05:00.000Z", now)).toBe(
      "5 mins",
    );
    expect(formatHomeExpiryTime("2026-05-16T14:00:00.000Z", now)).toBe(
      "2 hours",
    );
    expect(formatHomeExpiryTime("2026-05-20T12:00:00.000Z", now)).toBe(
      "4 days",
    );
    expect(formatHomeExpiryTime("2026-05-15T12:00:00.000Z", now)).toBe(
      "expired",
    );
  });
});
