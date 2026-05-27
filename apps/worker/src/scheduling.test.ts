import { describe, expect, it } from "vitest";

import { nextDailyRunAtUtc, nextDailyWindowEndUtc } from "./scheduling.js";

describe("daily scheduling", () => {
  it("schedules today's local run when it is still ahead", () => {
    expect(
      nextDailyRunAtUtc({
        timeZone: "Europe/London",
        localTime: "02:00",
        now: new Date("2026-05-27T00:30:00.000Z"),
      }).toISOString(),
    ).toBe("2026-05-27T01:00:00.000Z");
  });

  it("schedules tomorrow's local run once today's run has passed", () => {
    expect(
      nextDailyRunAtUtc({
        timeZone: "Europe/London",
        localTime: "02:00",
        now: new Date("2026-05-27T02:30:00.000Z"),
      }).toISOString(),
    ).toBe("2026-05-28T01:00:00.000Z");
  });

  it("handles spring-forward DST days", () => {
    expect(
      nextDailyRunAtUtc({
        timeZone: "Europe/London",
        localTime: "02:00",
        now: new Date("2026-03-29T00:30:00.000Z"),
      }).toISOString(),
    ).toBe("2026-03-29T01:00:00.000Z");
  });

  it("handles fall-back DST days", () => {
    expect(
      nextDailyRunAtUtc({
        timeZone: "Europe/London",
        localTime: "02:00",
        now: new Date("2026-10-25T00:30:00.000Z"),
      }).toISOString(),
    ).toBe("2026-10-25T02:00:00.000Z");
  });

  it("keeps the dedupe window open until the following local daily run", () => {
    expect(
      nextDailyWindowEndUtc({
        timeZone: "Europe/London",
        localTime: "02:00",
        runAt: new Date("2026-05-27T01:00:00.000Z"),
      }).toISOString(),
    ).toBe("2026-05-28T01:00:00.000Z");
  });
});
