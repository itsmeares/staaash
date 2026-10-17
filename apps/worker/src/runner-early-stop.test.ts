import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const db = vi.hoisted(() => ({
  claimDueBackgroundJob: vi.fn(),
  findBackgroundJobById: vi.fn(),
  heartbeatWorkerInstance: vi.fn(async () => undefined),
  markBackgroundJobFailed: vi.fn(),
  markBackgroundJobSucceeded: vi.fn(async () => undefined),
  markBackgroundJobTerminal: vi.fn(),
  recordBackgroundJobEvent: vi.fn(async () => undefined),
  renewBackgroundJobLease: vi.fn(async () => undefined),
}));
const registry = vi.hoisted(() => ({
  run: vi.fn(async () => undefined),
  scheduleNextPeriodicRun: vi.fn(async () => undefined),
}));

vi.mock("@staaash/db/jobs", () => ({ BACKGROUND_JOB_LEASE_MS: 60_000, ...db }));
vi.mock("@staaash/db/reconciliation", () => ({
  failRestoreReconciliationRun: vi.fn(),
  markRestoreReconciliationRunQueued: vi.fn(),
}));
vi.mock("./handlers/storage-mutation-recovery.js", () => ({
  recoverStorageMutations: vi.fn(),
}));
vi.mock("./job-registry.js", () => ({
  getJobRegistryEntry: () => ({
    timeoutMs: 60_000,
    cancellable: false,
    parsePayload: () => ({}),
    run: registry.run,
  }),
  scheduleNextPeriodicRun: registry.scheduleNextPeriodicRun,
  schedulePeriodicJobs: vi.fn(),
}));

import { WorkerRunner } from "./runner";

const job = { id: "job-1", kind: "media.derivative.generate", payloadJson: {} };
const runner = () =>
  new WorkerRunner({
    workerId: "worker-1",
    storagePaths: {} as never,
  });

describe("worker runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.claimDueBackgroundJob.mockResolvedValueOnce(job);
  });

  // A handler that stops early used to leave the job running; the lease then
  // ran out and the job was claimed again every minute, forever.
  it("finishes a job whose handler stops early without a cancellation", async () => {
    db.findBackgroundJobById.mockResolvedValue({ ...job, status: "running" });
    registry.run.mockResolvedValueOnce({ cancelled: true } as never);

    await runner().processNextJob();

    expect(db.markBackgroundJobSucceeded).toHaveBeenCalledWith({
      jobId: "job-1",
      workerId: "worker-1",
    });
  });

  it("leaves a cancelled job cancelled", async () => {
    db.findBackgroundJobById.mockResolvedValue({ ...job, status: "cancelled" });

    await runner().processNextJob();

    expect(db.markBackgroundJobSucceeded).not.toHaveBeenCalled();
    expect(db.recordBackgroundJobEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cancel_ack" }),
    );
  });
});
