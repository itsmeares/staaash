import { describe, expect, it } from "vite-plus/test";

import { buildRestoreReconciliationHealthSummary } from "@/server/restore";

describe("restore reconciliation", () => {
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

  it("warns when a completed check skipped files or found checksum errors", () => {
    const run = {
      id: "run",
      status: "succeeded" as const,
      triggeredByUserId: null,
      backgroundJobId: "job",
      startedAt: new Date(),
      completedAt: new Date(),
      missingOriginalCount: 0,
      orphanedStorageCount: 0,
      details: {
        missingOriginals: [],
        orphanedStorageKeys: [],
        uncheckedOriginalCount: 1,
      },
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(buildRestoreReconciliationHealthSummary(run)).toMatchObject({
      status: "warning",
      message: expect.stringContaining("could not verify 1"),
    });
    expect(
      buildRestoreReconciliationHealthSummary({
        ...run,
        details: {
          missingOriginals: [],
          orphanedStorageKeys: [],
          checksumMismatches: [{ fileId: "f", storageKey: "files/…/f" }],
        },
      }),
    ).toMatchObject({
      status: "warning",
      message: expect.stringContaining("incorrect checksums"),
    });
  });
});
