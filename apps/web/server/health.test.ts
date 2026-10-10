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
  updateStatus: "unchecked" as const,
  latestVersion: null,
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
        probeStatus: "healthy",
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

  it("works out update state against the running version", () => {
    const version = resolveVersionHealth(
      {
        lastUpdateCheckAt: new Date("2026-10-10T12:00:00Z"),
        updateCheckError: null,
        updateReleases: [
          {
            version: "99.0.0",
            name: null,
            notes: "",
            publishedAt: null,
            url: null,
          },
        ],
      },
      {
        updateCheckEnabled: true,
        updateChannel: null,
        updateCheckRepository: "itsmeares/staaash",
      } as never,
    );

    expect(version).toMatchObject({
      lastUpdateCheckAt: "2026-10-10T12:00:00.000Z",
      updateStatus: "update-available",
      latestVersion: "99.0.0",
    });
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
        probeStatus: "healthy",
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
