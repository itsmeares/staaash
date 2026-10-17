import { describe, expect, it } from "vite-plus/test";

import { formatRelativeTime } from "@/lib/time";

import { formatTimeUntil } from "@/lib/time";

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

    expect(formatTimeUntil("2026-05-16T12:05:00.000Z", now)).toBe("5 minutes");
    expect(formatTimeUntil("2026-05-16T14:00:00.000Z", now)).toBe("2 hours");
    expect(formatTimeUntil("2026-05-20T12:00:00.000Z", now)).toBe("4 days");
    expect(formatTimeUntil("2026-06-13T12:00:00.000Z", now)).toBe("4 weeks");
    expect(formatTimeUntil("2026-05-15T12:00:00.000Z", now)).toBe("expired");
  });
});
