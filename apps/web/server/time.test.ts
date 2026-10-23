import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DateTime, TimeProvider } from "@/components/time-provider";
import { TimeZonePicker } from "@/components/time-zone-picker";
import {
  formatDateTime,
  formatRelativeTime,
  getDateGroup,
  groupByDate,
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
  const label = (value: string, now: Date, zone = "UTC") =>
    getDateGroup(value, now, zone).label;

  it("buckets by calendar day in the viewer's zone, not elapsed hours", () => {
    // 01:00 Thursday in London, the upload was 23:30 Wednesday London time.
    const now = new Date("2026-05-21T00:00:00.000Z");
    const upload = "2026-05-20T22:30:00.000Z";

    expect(label(upload, now)).toBe("Yesterday");
    expect(label(upload, now, "Europe/London")).toBe("Yesterday");
    expect(label(upload, now, "America/New_York")).toBe("Today");
    expect(label("2026-05-20T23:30:00.000Z", now, "Europe/London")).toBe(
      "Today",
    );
  });

  it("names this week's days, then months, with the year when it differs", () => {
    // Thursday 21 May 2026; the week started on Monday 18 May.
    const now = new Date("2026-05-21T12:00:00.000Z");
    expect(label("2026-05-18T08:00:00.000Z", now)).toBe("Monday");
    expect(label("2026-05-17T08:00:00.000Z", now)).toBe("May");
    expect(label("2026-03-01T08:00:00.000Z", now)).toBe("March");
    expect(label("2025-12-24T08:00:00.000Z", now)).toBe("December 2025");

    // On a Monday only today and yesterday come before the month.
    const monday = new Date("2026-05-18T12:00:00.000Z");
    expect(label("2026-05-16T12:00:00.000Z", monday)).toBe("May");
  });

  it("orders groups newest first, or oldest first", () => {
    const now = new Date("2026-05-21T12:00:00.000Z");
    const dates = [
      "2026-03-01T08:00:00.000Z",
      "2026-05-21T08:00:00.000Z",
      "2026-05-19T08:00:00.000Z",
      "2025-12-24T08:00:00.000Z",
    ];
    const labels = (oldestFirst: boolean) =>
      groupByDate(dates, (date) => date, now, "UTC", oldestFirst).map(
        (group) => group.label,
      );
    expect(labels(false)).toEqual([
      "Today",
      "Tuesday",
      "March",
      "December 2025",
    ]);
    expect(labels(true)).toEqual([
      "December 2025",
      "March",
      "Tuesday",
      "Today",
    ]);
  });

  it("handles the 2026 daylight-saving ends", () => {
    // London falls back on 25 Oct 2026, New York on 1 Nov 2026. Those days
    // are 25 hours long, which breaks "days = elapsed / 24h" maths.
    expect(
      label(
        "2026-10-25T00:30:00.000Z",
        new Date("2026-10-25T23:30:00.000Z"),
        "Europe/London",
      ),
    ).toBe("Today");
    expect(
      label(
        "2026-10-31T23:30:00.000Z",
        new Date("2026-11-02T04:30:00.000Z"),
        "America/New_York",
      ),
    ).toBe("Yesterday");
  });
});

describe("zoned formatting", () => {
  it("renders a closed picker without formatting every supported time zone", () => {
    const formatter = vi.spyOn(Intl, "DateTimeFormat");
    try {
      const html = renderToString(
        createElement(TimeZonePicker, {
          value: "Europe/London",
        }),
      );
      expect(html).toContain("Europe/London");
      expect(formatter.mock.calls.length).toBeLessThan(10);
    } finally {
      formatter.mockRestore();
    }
  });

  it("keeps date-specific daylight-saving offsets when reusing a formatter", () => {
    const summer = "2026-07-01T12:00:00.000Z";
    const winter = "2026-12-01T12:00:00.000Z";
    expect(formatDateTime(summer, "Europe/London")).toBe("1 Jul 2026, 13:00");
    expect(formatDateTime(winter, "Europe/London")).toBe("1 Dec 2026, 12:00");
    expect(formatDateTime(summer, "America/New_York")).toBe(
      "1 Jul 2026, 08:00",
    );
    expect(formatDateTime(winter, "America/New_York")).toBe(
      "1 Dec 2026, 07:00",
    );
    expect(formatDateTime(summer, "Europe/London")).toBe("1 Jul 2026, 13:00");
  });

  it("renders absolute times in the requested zone", () => {
    const value = "2026-07-01T12:00:00.000Z";
    expect(formatDateTime(value, "UTC")).toBe("1 Jul 2026, 12:00");
    expect(formatDateTime(value, "Europe/London")).toBe("1 Jul 2026, 13:00");
    expect(formatDateTime(value, "America/New_York")).toBe("1 Jul 2026, 08:00");
    expect(formatDateTime(value, "UTC", "12h")).toMatch(
      /^1 Jul 2026, 12:00\spm$/i,
    );
  });
});


describe("TimeProvider render", () => {
  it("renders in the chosen zone and clock", () => {
    const html = renderToString(
      createElement(TimeProvider, {
        timeZone: "America/New_York",
        clock: "12h",
        children: createElement(DateTime, {
          value: "2026-07-01T12:00:00.000Z",
        }),
      }),
    );

    expect(html).toContain("1 Jul 2026, 08:00 am");
    expect(html).toContain('dateTime="2026-07-01T12:00:00.000Z"');
  });
});
