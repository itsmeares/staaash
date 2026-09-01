import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/app-version", () => ({
  resolveAppVersion: () => "2.0.0",
}));

import {
  buildInstanceHealthSummary,
  getWorkerHeartbeatStatus,
  resolveVersionHealth,
  toJsonInstanceHealthSummary,
} from "@/server/health";

const baseVersionInfo = {
  currentVersion: "0.3.0-beta.1",
  lastUpdateCheckAt: null,
  updateCheckStatus: null,
  updateCheckMessage: null,
  latestAvailableVersion: null,
};

const baseReconciliation = {
  status: "healthy" as const,
  runStatus: "succeeded" as const,
  lastCompletedAt: "2026-04-09T10:00:00.000Z",
  missingOriginalCount: 0,
  orphanedStorageCount: 0,
  message: "Latest restore check completed without issues.",
};

describe("health summaries", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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
        cancelled: 0,
        oldestQueuedAgeSeconds: null,
        staleRunning: 0,
        status: "healthy",
      },
      reconciliation: baseReconciliation,
      storageWarnings: {
        status: "healthy",
        freeBytes: 10n,
        totalBytes: 20n,
        message: "Disk capacity is healthy.",
      },
      versionInfo: baseVersionInfo,
    });

    expect(summary.ok).toBe(true);
    expect(summary.version.currentVersion).toBe("0.3.0-beta.1");
    expect(summary.version.lastUpdateCheckAt).toBeNull();
  });

  it("does not flip update-available when a real comparison is unavailable", () => {
    const version = resolveVersionHealth({
      lastUpdateCheckAt: null,
      updateCheckStatus: "update-available",
      updateCheckMessage: "Update available: 1.0.0.",
      latestAvailableVersion: "1.0.0",
      checkedVersion: null,
    });

    expect(version.updateCheckStatus).toBe("update-available");
    expect(version.updateCheckMessage).toBe("Update available: 1.0.0.");
  });

  it.each(["production", "test"])(
    "invalidates stale version health in %s",
    (nodeEnv) => {
      vi.stubEnv("NODE_ENV", nodeEnv);

      const version = resolveVersionHealth({
        lastUpdateCheckAt: null,
        updateCheckStatus: "up-to-date",
        updateCheckMessage: "Instance is up to date.",
        latestAvailableVersion: "1.0.0",
        checkedVersion: "1.0.0",
      });

      expect(version).toMatchObject({
        currentVersion: "2.0.0",
        updateCheckStatus: null,
        latestAvailableVersion: null,
      });
      expect(version).not.toHaveProperty("checkedVersion");
    },
  );

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
        cancelled: 0,
        oldestQueuedAgeSeconds: null,
        staleRunning: 0,
        status: "healthy",
      },
      reconciliation: baseReconciliation,
      storageWarnings: {
        status: "healthy",
        freeBytes: 10n,
        totalBytes: 20n,
        message: "Disk capacity is healthy.",
      },
      versionInfo: baseVersionInfo,
    });

    const jsonSummary = toJsonInstanceHealthSummary(summary);

    expect(jsonSummary.storageWarnings.freeBytes).toBe("10");
    expect(jsonSummary.storageWarnings.totalBytes).toBe("20");
    expect(() => JSON.stringify(jsonSummary)).not.toThrow();
  });
});
