import type { JobContext } from "./job-context.js";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  find: vi.fn(),
  succeeded: vi.fn(),
  claim: vi.fn(),
  heartbeat: vi.fn(),
  connect: vi.fn(),
  close: vi.fn(),
  wake: () => {},
}));
// The fake clock does not replace node:timers/promises.
vi.mock("node:timers/promises", () => ({
  setTimeout: (
    ms: number,
    value: unknown,
    options?: { signal?: AbortSignal },
  ) =>
    new Promise((resolve, reject) => {
      const signal = options?.signal;
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      }, ms);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    }),
}));
vi.mock("@staaash/db/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/jobs")>()),
  claimDueBackgroundJob: mocks.claim,
  heartbeatWorkerInstance: mocks.heartbeat,
  findBackgroundJobById: mocks.find,
  markBackgroundJobSucceeded: mocks.succeeded,
  recordBackgroundJobEvent: vi.fn().mockResolvedValue(undefined),
  renewBackgroundJobLease: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./job-registry.js", () => ({
  getJobRegistryEntry: () => ({
    timeoutMs: 60000,
    cancellable: true,
    parsePayload: () => {},
    run: mocks.run,
  }),
  scheduleNextPeriodicRun: vi.fn().mockResolvedValue(undefined),
  schedulePeriodicJobs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./handlers/storage-mutation-recovery.js", () => ({
  recoverStorageMutations: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./job-notifications.js", () => ({
  JobNotifications: class {
    constructor(wake: () => void) {
      mocks.wake = wake;
    }
    connect = mocks.connect;
    close = mocks.close;
  },
}));

import { WorkerRunner } from "./runner.js";

const makeRunner = () =>
  new WorkerRunner({
    workerId: "test-worker",
    storagePaths: {
      filesRoot: "/unused",
      tmpRoot: "/unused/tmp",
      heartbeatPath: "/unused/heartbeat",
      pendingDeleteRoot: "/unused/pending",
      uploadStagingTtlMs: 1000,
    },
  });
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe("worker idle wake-up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.find.mockResolvedValue({ status: "running" });
    mocks.claim.mockResolvedValue(null);
    mocks.heartbeat.mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("interrupts the longest idle wait and coalesces a notification burst", async () => {
    const runner = makeRunner();
    const running = runner.start();
    await vi.advanceTimersByTimeAsync(30_000);
    const before = mocks.claim.mock.calls.length;
    expect(before).toBe(5);
    for (let i = 0; i < 100; i++) mocks.wake();
    await flush();
    expect(mocks.claim).toHaveBeenCalledTimes(before + 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(mocks.claim).toHaveBeenCalledTimes(before + 1);
    const stopped = runner.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([running, stopped]);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("retains a notification between the empty claim and the idle wait", async () => {
    let finishHeartbeat = () => {};
    mocks.heartbeat.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishHeartbeat = resolve;
      }),
    );
    const runner = makeRunner();
    const running = runner.start();
    await flush();
    expect(mocks.claim).toHaveBeenCalledOnce();
    mocks.wake();
    finishHeartbeat();
    await flush();
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    const stopped = runner.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([running, stopped]);
  });

  it("keeps polling without notifications for missed signals and future jobs", async () => {
    const runner = makeRunner();
    const running = runner.start();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.claim).toHaveBeenCalledTimes(7);
    const stopped = runner.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([running, stopped]);
  });

  it("keeps an active job exclusive and still observes cancellation after a wake", async () => {
    const job: BackgroundJobRecord = {
      id: "active",
      kind: "media.derivative.generate",
      status: "running",
      payloadJson: {},
      dedupeKey: null,
      runAt: new Date(),
      lockedAt: new Date(),
      lockedBy: "test-worker",
      attemptCount: 1,
      maxAttempts: 3,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mocks.claim.mockResolvedValueOnce(job);
    mocks.run.mockImplementation(
      async (_job: unknown, _paths: unknown, context: JobContext) => {
        await new Promise<void>((resolve) =>
          context.signal.addEventListener("abort", () => resolve(), {
            once: true,
          }),
        );
        return { cancelled: true };
      },
    );
    const runner = makeRunner();
    const running = runner.start();
    await flush();
    expect(mocks.run).toHaveBeenCalledOnce();
    for (let i = 0; i < 100; i++) mocks.wake();
    await flush();
    expect(mocks.claim).toHaveBeenCalledOnce();
    mocks.find.mockResolvedValue({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(3000);
    expect(mocks.claim.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.succeeded).not.toHaveBeenCalled();
    const stopped = runner.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([running, stopped]);
  });

  it("finishes an idle runner on shutdown without waiting 30 seconds", async () => {
    const runner = makeRunner();
    const running = runner.start();
    await vi.advanceTimersByTimeAsync(30_000);
    const before = mocks.claim.mock.calls.length;
    const stopped = runner.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([running, stopped]);
    expect(mocks.claim).toHaveBeenCalledTimes(before);
  });
});
