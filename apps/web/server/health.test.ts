import { describe, expect, it } from "vitest";

import {
  buildInstanceHealthSummary,
  getWorkerHeartbeatStatus,
  toJsonInstanceHealthSummary,
} from "@/server/health";

describe("health summaries", () => {
  it("marks missing heartbeat as a warning", () => {
    expect(getWorkerHeartbeatStatus(null).status).toBe("warning");
  });

  it("marks stale heartbeat as an error", () => {
    const lastSeen = new Date("2026-03-01T00:00:00.000Z");
    const now = new Date(lastSeen.getTime() + 999999);
    expect(getWorkerHeartbeatStatus(lastSeen, now, 1000).status).toBe("error");
  });

  it("builds a combined instance health summary", () => {
    const summary = buildInstanceHealthSummary({
      databaseStatus: "healthy",
      storageStatus: "healthy",
      worker: {
        status: "healthy",
        lastSeenAt: "2026-03-01T00:00:00.000Z",
        message: "Worker heartbeat is current.",
      },
      queue: {
        queued: 0,
        running: 0,
        failed: 0,
        dead: 0,
        status: "healthy",
      },
      storageWarnings: {
        status: "healthy",
        freeBytes: 10n,
        totalBytes: 20n,
        message: "Disk capacity is healthy.",
      },
    });

    expect(summary.ok).toBe(true);
    expect(summary.version.currentVersion).toBe("0.1.0");
  });

  it("serializes bigint storage warnings for JSON routes", () => {
    const summary = buildInstanceHealthSummary({
      databaseStatus: "healthy",
      storageStatus: "healthy",
      worker: {
        status: "healthy",
        lastSeenAt: "2026-03-01T00:00:00.000Z",
        message: "Worker heartbeat is current.",
      },
      queue: {
        queued: 0,
        running: 0,
        failed: 0,
        dead: 0,
        status: "healthy",
      },
      storageWarnings: {
        status: "healthy",
        freeBytes: 10n,
        totalBytes: 20n,
        message: "Disk capacity is healthy.",
      },
    });

    const jsonSummary = toJsonInstanceHealthSummary(summary);

    expect(jsonSummary.storageWarnings.freeBytes).toBe("10");
    expect(jsonSummary.storageWarnings.totalBytes).toBe("20");
    expect(() => JSON.stringify(jsonSummary)).not.toThrow();
  });
});
