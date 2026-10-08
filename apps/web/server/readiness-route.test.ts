import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  settingsFail: false,
  dbFail: false,
  recovery: false,
  reconciliationFail: false,
  mutationFail: false,
  protocolFail: false,
  queueFail: false,
  workerStale: false,
  deadJobs: false,
  staleJobs: false,
  error: new Error("Synthetic database/settings unavailable"),
}));
vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    systemSettings: {
      findUnique: vi.fn(async () => {
        if (state.settingsFail) throw state.error;
        return { workerHeartbeatMaxAgeSeconds: 120 };
      }),
    },
    instance: {
      findUnique: vi.fn(async () => {
        if (state.protocolFail) throw state.error;
        return { storageProtocolVersion: 2 };
      }),
    },
  }),
}));
vi.mock("@staaash/db/health", () => ({
  probeDatabaseReachability: vi.fn(async () => ({
    status: state.dbFail ? "error" : "healthy",
  })),
  getQueueBacklogSummary: vi.fn(async () => ({
    probeStatus: state.queueFail || state.dbFail ? "error" : "healthy",
    status:
      state.queueFail || state.deadJobs || state.staleJobs
        ? "error"
        : "healthy",
    queued: 0,
    running: 0,
    failed: 0,
    dead: state.deadJobs ? 1 : 0,
    cancelled: 0,
    oldestQueuedAgeSeconds: null,
    staleRunning: state.staleJobs ? 1 : 0,
  })),
}));
vi.mock("@staaash/db/instance", () => ({
  readInstanceUpdateCheck: vi.fn(async () => null),
}));
vi.mock("@staaash/db/jobs", () => ({
  listWorkerInstances: vi.fn(async () => [
    {
      lastHeartbeatAt: new Date(Date.now() - (state.workerStale ? 300_000 : 0)),
    },
  ]),
}));
vi.mock("@staaash/db/reconciliation", () => ({
  readLatestRestoreReconciliationRun: vi.fn(async () => null),
}));
vi.mock("@staaash/db/storage-mutations", () => ({
  getStorageMutationHealth: vi.fn(async () => {
    if (state.mutationFail) throw state.error;
    return {
      counts: state.recovery ? { recovery_required: 1 } : {},
      oldest: null,
      active: [],
    };
  }),
}));
vi.mock("@staaash/db/storage-mutation-executor", () => ({
  assertStorageFilesystemSupported: vi.fn(),
}));
vi.mock("@/server/storage", () => ({
  ensureStorageDirectories: vi.fn(),
  getStorageRoot: () => "synthetic-storage",
  getWorkerHeartbeatPath: () => "synthetic-heartbeat",
}));
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(async () =>
    JSON.stringify({ timestamp: new Date().toISOString() }),
  ),
  statfs: vi.fn(async () => ({ bavail: 100, bsize: 1, blocks: 100 })),
}));
vi.mock("@/server/app-version", () => ({ resolveAppVersion: () => "1.2.0" }));
vi.mock("@/server/restore", () => ({
  buildRestoreReconciliationHealthSummary: () => ({
    status: state.reconciliationFail ? "error" : "healthy",
  }),
}));
import { getReadiness } from "@/server/health";
import { GET } from "@/app/api/health/ready/route";
describe("public readiness response", () => {
  beforeEach(() => {
    state.settingsFail = false;
    state.dbFail = false;
    state.recovery = false;
    state.reconciliationFail = false;
    state.mutationFail = false;
    state.protocolFail = false;
    state.queueFail = false;
    state.workerStale = false;
    state.deadJobs = false;
    state.staleJobs = false;
  });
  it("returns structured 503 during a database/settings outage and recovers on the next request", async () => {
    state.settingsFail = true;
    state.dbFail = true;
    state.mutationFail = true;
    state.protocolFail = true;
    const failed = await GET();
    expect(failed.status).toBe(503);
    const body = await failed.json();
    expect(body).toMatchObject({
      ok: false,
      checks: {
        database: "error",
        settings: "error",
        storage: "error",
        worker: "error",
        storageMutations: "error",
      },
    });
    expect(body.failures).toEqual(
      expect.arrayContaining([
        "DATABASE_UNAVAILABLE",
        "SETTINGS_UNAVAILABLE",
        "STORAGE_UNAVAILABLE",
        "WORKER_SETTINGS_UNAVAILABLE",
        "STORAGE_MUTATION_HEALTH_UNAVAILABLE",
      ]),
    );
    expect(JSON.stringify(body)).not.toContain(state.error.message);
    state.settingsFail = false;
    state.dbFail = false;
    state.mutationFail = false;
    state.protocolFail = false;
    const recovered = await GET();
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toMatchObject({ ok: true, failures: [] });
  });
  it("a settings-only failure stays unready without inventing a worker threshold", async () => {
    state.settingsFail = true;
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.checks.database).toBe("healthy");
    expect(body.checks.settings).toBe("error");
    expect(body.checks.worker).toBe("error");
    expect(body.failures).toEqual([
      "SETTINGS_UNAVAILABLE",
      "WORKER_SETTINGS_UNAVAILABLE",
    ]);
    const summary = await getReadiness();
    expect(summary.checks.settings.message).toContain(state.error.message);
  });
  it.each([
    ["recovery", "storageMutations", "STORAGE_RECOVERY_REQUIRED"],
    ["reconciliationFail", "reconciliation", "RESTORE_RECONCILIATION_FAILED"],
    ["mutationFail", "storageMutations", "STORAGE_MUTATION_HEALTH_UNAVAILABLE"],
    ["protocolFail", "storage", "STORAGE_UNAVAILABLE"],
    ["queueFail", "queue", "QUEUE_PROBE_UNAVAILABLE"],
    ["workerStale", "worker", "WORKER_UNHEALTHY"],
  ] as const)("publishes the %s blocker", async (flag, check, code) => {
    state[flag] = true;
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.checks[check]).toBe("error");
    expect(body.failures).toContain(code);
  });
  it.each(["deadJobs", "staleJobs"] as const)(
    "keeps traffic ready when %s need attention",
    async (flag) => {
      state[flag] = true;
      const response = await GET();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: true,
        failures: [],
        checks: { queue: "healthy" },
        operational: {
          status: "warning",
          incidents: [flag === "deadJobs" ? "DEAD_JOBS" : "STALE_JOBS"],
        },
      });
      const summary = await getReadiness();
      expect(summary.queue.status).toBe("error");
      state.recovery = true;
      const blocked = await GET();
      expect(blocked.status).toBe(503);
      expect((await blocked.json()).failures).toContain(
        "STORAGE_RECOVERY_REQUIRED",
      );
    },
  );
});
