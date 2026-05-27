import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAINTENANCE_RUN_TIME,
  DEFAULT_TIME_ZONE,
  isValidMaintenanceRunTime,
  isValidTimeZone,
  normalizeMaintenanceRunTime,
  normalizeTimeZone,
} from "../src/time-zone.js";

describe("time zone helpers", () => {
  it("accepts IANA time zones and rejects invalid zones", () => {
    expect(isValidTimeZone("Europe/London")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });

  it("normalizes missing or invalid time zones to UTC", () => {
    expect(normalizeTimeZone(null)).toBe(DEFAULT_TIME_ZONE);
    expect(normalizeTimeZone("Not/AZone")).toBe(DEFAULT_TIME_ZONE);
    expect(normalizeTimeZone("America/New_York")).toBe("America/New_York");
  });

  it("validates HH:mm maintenance run times", () => {
    expect(isValidMaintenanceRunTime("02:00")).toBe(true);
    expect(isValidMaintenanceRunTime("23:59")).toBe(true);
    expect(isValidMaintenanceRunTime("24:00")).toBe(false);
    expect(isValidMaintenanceRunTime("2:00")).toBe(false);
  });

  it("normalizes invalid maintenance run times to the default", () => {
    expect(normalizeMaintenanceRunTime("24:00")).toBe(
      DEFAULT_MAINTENANCE_RUN_TIME,
    );
    expect(normalizeMaintenanceRunTime("05:30")).toBe("05:30");
  });
});
