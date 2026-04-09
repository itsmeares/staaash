import { describe, expect, it } from "vitest";

import {
  buildRestoreReconciliationHealthSummary,
  createRestoreReconciliationReport,
  hasRestoreIssues,
} from "@/server/restore";

describe("restore reconciliation", () => {
  it("creates empty reconciliation reports by default", () => {
    expect(createRestoreReconciliationReport()).toEqual({
      missingOriginalIds: [],
      orphanedStorageKeys: [],
    });
  });

  it("flags restore reports with missing originals or orphaned storage", () => {
    expect(
      hasRestoreIssues(
        createRestoreReconciliationReport({
          missingOriginalIds: ["file-1"],
        }),
      ),
    ).toBe(true);
  });

  it("marks clean completed runs as healthy and failed runs as errors", () => {
    expect(
      buildRestoreReconciliationHealthSummary({
        id: "run-1",
        status: "succeeded",
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-1",
        startedAt: new Date("2026-04-09T10:00:00.000Z"),
        completedAt: new Date("2026-04-09T10:01:00.000Z"),
        missingOriginalCount: 0,
        orphanedStorageCount: 0,
        details: {
          missingOriginals: [],
          orphanedStorageKeys: [],
        },
        lastError: null,
        createdAt: new Date("2026-04-09T10:00:00.000Z"),
        updatedAt: new Date("2026-04-09T10:01:00.000Z"),
      }).status,
    ).toBe("healthy");

    expect(
      buildRestoreReconciliationHealthSummary({
        id: "run-2",
        status: "failed",
        triggeredByUserId: "owner-1",
        backgroundJobId: "job-2",
        startedAt: null,
        completedAt: new Date("2026-04-09T11:00:00.000Z"),
        missingOriginalCount: 0,
        orphanedStorageCount: 0,
        details: {
          missingOriginals: [],
          orphanedStorageKeys: [],
        },
        lastError: "scan failed",
        createdAt: new Date("2026-04-09T11:00:00.000Z"),
        updatedAt: new Date("2026-04-09T11:00:00.000Z"),
      }).status,
    ).toBe("error");
  });
});
