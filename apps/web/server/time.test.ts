import { createElement, Fragment } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DateTime, TimeProvider, useTime } from "@/components/time-provider";
import {
  formatDateTime,
  formatRelativeTime,
  getDateGroup,
  getZonedHour,
} from "@/lib/time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-05-19T12:00:00.000Z");

  it("labels minute, hour and day thresholds", () => {
    const at = (iso: string) => formatRelativeTime(iso, now, "UTC");

    expect(at("2026-05-19T12:00:00.000Z")).toBe("Just now");
    expect(at("2026-05-19T11:59:01.000Z")).toBe("Just now");
    expect(at("2026-05-19T11:59:00.000Z")).toBe("1m ago");
    expect(at("2026-05-19T11:55:00.000Z")).toBe("5m ago");
    expect(at("2026-05-19T11:00:01.000Z")).toBe("59m ago");
    expect(at("2026-05-19T11:00:00.000Z")).toBe("1h ago");
    expect(at("2026-05-18T12:00:01.000Z")).toBe("23h ago");
    expect(at("2026-05-18T10:00:00.000Z")).toBe("Yesterday");
    expect(at("2026-05-15T12:00:00.000Z")).toBe("4 days ago");
  });

  it("formats older dates in the viewer's zone", () => {
    // 23:30 UTC on 1 May is already 2 May in Tokyo.
    const older = "2026-05-01T23:30:00.000Z";
    expect(formatRelativeTime(older, now, "UTC")).toBe("May 1");
    expect(formatRelativeTime(older, now, "Asia/Tokyo")).toBe("May 2");
  });
});

describe("getDateGroup", () => {
  it("buckets by calendar day in the viewer's zone, not elapsed hours", () => {
    // 01:00 Thursday in London, the upload was 23:30 Wednesday London time.
    const now = new Date("2026-05-21T00:00:00.000Z");
    const upload = "2026-05-20T22:30:00.000Z";

    expect(getDateGroup(upload, now, "UTC")).toBe("Yesterday");
    expect(getDateGroup(upload, now, "Europe/London")).toBe("Yesterday");
    expect(getDateGroup(upload, now, "America/New_York")).toBe("Today");
    expect(getDateGroup("2026-05-20T23:30:00.000Z", now, "Europe/London")).toBe(
      "Today",
    );
  });

  it("starts the week on Monday", () => {
    // Thursday 21 May 2026.
    const now = new Date("2026-05-21T12:00:00.000Z");
    expect(getDateGroup("2026-05-18T08:00:00.000Z", now, "UTC")).toBe(
      "This week",
    );
    expect(getDateGroup("2026-05-17T08:00:00.000Z", now, "UTC")).toBe(
      "This month",
    );
    expect(getDateGroup("2026-03-01T08:00:00.000Z", now, "UTC")).toBe("Older");

    // On a Monday only today and yesterday come before "This month".
    const monday = new Date("2026-05-18T12:00:00.000Z");
    expect(getDateGroup("2026-05-16T12:00:00.000Z", monday, "UTC")).toBe(
      "This month",
    );
  });

  it("handles the 2026 daylight-saving ends", () => {
    // London falls back on 25 Oct 2026, New York on 1 Nov 2026. Those days
    // are 25 hours long, which breaks "days = elapsed / 24h" maths.
    expect(
      getDateGroup(
        "2026-10-25T00:30:00.000Z",
        new Date("2026-10-25T23:30:00.000Z"),
        "Europe/London",
      ),
    ).toBe("Today");
    expect(
      getDateGroup(
        "2026-10-31T23:30:00.000Z",
        new Date("2026-11-02T04:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe("Yesterday");
  });
});

describe("zoned formatting", () => {
  it("renders absolute times in the requested zone", () => {
    const value = "2026-07-01T12:00:00.000Z";
    expect(formatDateTime(value, "UTC")).toBe("1 Jul 2026, 12:00");
    expect(formatDateTime(value, "Europe/London")).toBe("1 Jul 2026, 13:00");
    expect(formatDateTime(value, "America/New_York")).toBe("1 Jul 2026, 08:00");
  });

  it("reads the hour in the requested zone", () => {
    const now = new Date("2026-07-01T23:30:00.000Z");
    expect(getZonedHour(now, "UTC")).toBe(23);
    expect(getZonedHour(now, "Asia/Tokyo")).toBe(8);
  });
});

function Relative() {
  const { now, timeZone } = useTime();
  return formatRelativeTime("2026-07-01T11:55:00.000Z", now, timeZone);
}

describe("TimeProvider render", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // Hydration only works if the first render ignores the runtime clock and
  // zone. Render with a system clock far from serverNow and check the output
  // depends on the props alone.
  it("renders from serverNow and the given zone only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));

    const html = renderToString(
      createElement(TimeProvider, {
        autoDetect: false,
        serverNow: Date.parse("2026-07-01T12:00:00.000Z"),
        timeZone: "America/New_York",
        children: createElement(
          Fragment,
          null,
          createElement(DateTime, { value: "2026-07-01T12:00:00.000Z" }),
          createElement(Relative),
        ),
      }),
    );

    expect(html).toContain("1 Jul 2026, 08:00");
    expect(html).toContain("5m ago");
    expect(html).toContain('dateTime="2026-07-01T12:00:00.000Z"');
  });
});
