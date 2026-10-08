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

describe("traffic readiness and operational incidents", () => {
  const healthyInput = (): Parameters<
    typeof buildInstanceHealthSummary
  >[0] => ({
    databaseStatus: "healthy",
    storageStatus: "healthy",
    worker: {
      status: "healthy",
      lastSeenAt: "2026-10-08T00:00:00.000Z",
      message: "Current",
    },
    queue: {
      probeStatus: "healthy",
      status: "healthy",
      queued: 0,
      running: 0,
      failed: 0,
      dead: 0,
      cancelled: 0,
      oldestQueuedAgeSeconds: null,
      staleRunning: 0,
    },
    reconciliation: { ...baseReconciliation },
    storageWarnings: {
      status: "healthy",
      freeBytes: 10n,
      totalBytes: 20n,
      message: "Healthy",
    },
    versionInfo: { ...baseVersionInfo },
  });

  it("reports healthy operations when no incidents are present", () => {
    const summary = buildInstanceHealthSummary(healthyInput());
    expect(summary).toMatchObject({
      ok: true,
      failures: [],
      operational: { status: "healthy", incidents: [] },
      checks: { queue: { status: "healthy" } },
    });
  });

  it.each([
    ["dead", "DEAD_JOBS", "error"],
    ["failed", "FAILED_JOBS", "warning"],
    ["staleRunning", "STALE_JOBS", "error"],
  ] as const)(
    "reports %s jobs without blocking traffic",
    (field, incident, status) => {
      const input = healthyInput();
      input.queue[field] = 1;
      input.queue.status = status;
      expect(buildInstanceHealthSummary(input)).toMatchObject({
        ok: true,
        failures: [],
        operational: { status: "warning", incidents: [incident] },
        checks: { queue: { status: "healthy" } },
        queue: { status },
      });
    },
  );

  it.each([
    ["worker", "WORKER_WARNING"],
    ["reconciliation", "RECONCILIATION_WARNING"],
    ["storageWarnings", "STORAGE_WARNING"],
  ] as const)(
    "keeps %s warnings visible without failing readiness",
    (field, incident) => {
      const input = healthyInput();
      input[field].status = "warning";
      expect(buildInstanceHealthSummary(input)).toMatchObject({
        ok: true,
        failures: [],
        operational: { status: "warning", incidents: [incident] },
      });
    },
  );

  it("makes a failed probe block readiness even when the queue appears empty and healthy", () => {
    const input = healthyInput();
    input.queue.probeStatus = "error";
    expect(buildInstanceHealthSummary(input)).toMatchObject({
      ok: false,
      failures: ["QUEUE_PROBE_UNAVAILABLE"],
      operational: { status: "error", incidents: ["QUEUE_PROBE_UNAVAILABLE"] },
      checks: { queue: { status: "error" } },
    });
  });

  it("retains every incident while giving readiness failures operational error severity", () => {
    const input = healthyInput();
    input.queue = {
      ...input.queue,
      dead: 1,
      failed: 2,
      staleRunning: 3,
      status: "error",
    };
    input.worker.status = "warning";
    input.reconciliation.status = "warning";
    input.storageWarnings.status = "error";
    input.storageMutations = {
      counts: { recovery_required: 1 },
      oldest: null,
      active: [],
    };
    const summary = buildInstanceHealthSummary(input);
    expect(summary.ok).toBe(false);
    expect(summary.failures).toEqual(["STORAGE_RECOVERY_REQUIRED"]);
    expect(summary.operational.status).toBe("error");
    expect(summary.operational.incidents).toEqual([
      "STORAGE_RECOVERY_REQUIRED",
      "DEAD_JOBS",
      "FAILED_JOBS",
      "STALE_JOBS",
      "WORKER_WARNING",
      "RECONCILIATION_WARNING",
      "STORAGE_WARNING",
    ]);
    expect(toJsonInstanceHealthSummary(summary).operational).toEqual(
      summary.operational,
    );
  });
});
