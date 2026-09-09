import { describe, expect, it } from "vitest";

import {
  DEFAULT_UPLOAD_STAGING_RETENTION_HOURS,
  normalizeOptionalEnvValue,
  resolveUploadStagingRetentionHours,
} from "../src/upload-staging.js";

describe("upload staging retention", () => {
  it("normalizes blank environment values to absent", () => {
    expect(normalizeOptionalEnvValue("  ")).toBeUndefined();
    expect(normalizeOptionalEnvValue("5")).toBe("5");
  });

  it("prefers an explicit environment override", () => {
    expect(
      resolveUploadStagingRetentionHours({
        environmentHours: 2,
        databaseHours: 5,
      }),
    ).toBe(2);
  });

  it("uses the database setting when no override exists", () => {
    expect(resolveUploadStagingRetentionHours({ databaseHours: 5 })).toBe(5);
  });

  it("uses the default when neither source has a value", () => {
    expect(resolveUploadStagingRetentionHours({})).toBe(
      DEFAULT_UPLOAD_STAGING_RETENTION_HOURS,
    );
  });

  it("rejects invalid values before they reach cleanup", () => {
    expect(() =>
      resolveUploadStagingRetentionHours({ environmentHours: 0 }),
    ).toThrow("positive integer");
    expect(() =>
      resolveUploadStagingRetentionHours({ databaseHours: -1 }),
    ).toThrow("positive integer");
  });
});
