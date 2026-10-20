import type { JobContext } from "./job-context.js";
import type { BackgroundJobRecord, BackgroundJobLane } from "@staaash/db/jobs";
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
  recover: vi.fn().mockResolvedValue(undefined),
  schedule: vi.fn().mockResolvedValue(undefined),
  renew: vi.fn().mockResolvedValue(undefined),
  wakes: [] as (() => void)[],
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
  renewBackgroundJobLease: mocks.renew,
}));
vi.mock("./job-registry.js", () => ({
  getJobRegistryEntry: () => ({
    timeoutMs: 60000,
    cancellable: true,
    parsePayload: () => {},
    run: mocks.run,
  }),
  scheduleNextPeriodicRun: vi.fn().mockResolvedValue(undefined),
  schedulePeriodicJobs: mocks.schedule,
}));
vi.mock("./handlers/storage-mutation-recovery.js", () => ({
  recoverStorageMutations: mocks.recover,
}));
vi.mock("./job-notifications.js", () => ({
  JobNotifications: class {
    constructor(wake: () => void) {
      mocks.wake = wake;
      mocks.wakes.push(wake);
    }
    connect = mocks.connect;
    close = mocks.close;
  },
}));

import { WorkerRunner } from "./runner.js";

const makeRunner = (lane: BackgroundJobLane = "general") =>
  new WorkerRunner({
    workerId: `test-${lane}`,
    lane,
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
    mocks.wakes = [];
    mocks.run.mockReset();
    mocks.find.mockResolvedValue({ status: "running" });
    mocks.claim.mockReset().mockResolvedValue(null);
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

  it("runs small archives while a general job is blocked, with one job per lane", async () => {
    const jobs = {
      general: ["large-one", "large-two"],
      "small-archive": ["small-one", "small-two"],
      "small-media": ["thumb-one", "thumb-two"],
    };
    const active = new Map<string, () => void>();
    mocks.claim.mockImplementation(
      async ({
        lane,
        workerId,
      }: {
        lane: BackgroundJobLane;
        workerId: string;
      }) => {
        const id = jobs[lane].shift();
        return id
          ? { id, kind: "zip.archive.generate", lockedBy: workerId }
          : null;
      },
    );
    mocks.run.mockImplementation(async (job: BackgroundJobRecord) => {
      await new Promise<void>((resolve) => active.set(job.id, resolve));
    });
    const runners = [
      makeRunner(),
      makeRunner("small-archive"),
      makeRunner("small-media"),
    ];
    const running = runners.map((runner) => runner.start());
    await flush();
    expect([...active.keys()]).toEqual(["large-one", "small-one", "thumb-one"]);
    mocks.wakes.forEach((wake) => wake());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.claim).toHaveBeenCalledTimes(3);
    expect(mocks.renew).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: "large-one", workerId: "test-general" }),
    );
    expect(mocks.renew).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "small-one",
        workerId: "test-small-archive",
      }),
    );
    active.get("thumb-one")!();
    await flush();
    expect(active.has("thumb-two")).toBe(true);
    active.get("thumb-two")!();
    active.get("small-one")!();
    await flush();
    expect(active.has("small-two")).toBe(true);
    expect(active.has("large-two")).toBe(false);
    active.get("small-two")!();
    await flush();
    expect(mocks.succeeded).toHaveBeenCalledTimes(4);
    expect(mocks.heartbeat).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "test-general", status: "idle" }),
    );
    const stopped = runners.map((runner) => runner.stop());
    active.get("large-one")!();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([...running, ...stopped]);
    expect(active.has("large-two")).toBe(false);
    expect(mocks.succeeded).toHaveBeenCalledTimes(4);
  });

  it.each(["small-archive", "small-media"] as const)(
    "does not duplicate maintenance in the %s runner",
    async (lane) => {
      const runner = makeRunner(lane);
      const running = runner.start();
      await vi.advanceTimersByTimeAsync(61_000);
      expect(mocks.schedule).not.toHaveBeenCalled();
      expect(mocks.recover).not.toHaveBeenCalled();
      expect(
        mocks.claim.mock.calls.every(([options]) => options.lane === lane),
      ).toBe(true);
      await runner.stop();
      await running;
    },
  );

  it("waits for an in-flight claim on shutdown without starting its job", async () => {
    let finishClaim = (_job: object) => {};
    mocks.claim.mockReturnValueOnce(
      new Promise((resolve) => {
        finishClaim = resolve;
      }),
    );
    const runner = makeRunner("small-archive");
    const running = runner.start();
    await flush();
    let stopped = false;
    const stopping = runner.stop().then(() => {
      stopped = true;
    });
    await flush();
    expect(stopped).toBe(false);
    finishClaim({ id: "late-claim", kind: "zip.archive.generate" });
    await Promise.all([running, stopping]);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(stopped).toBe(true);
  });

  it("finishes shutdown when an in-flight claim fails", async () => {
    let failClaim = (_error: Error) => {};
    mocks.claim.mockReturnValueOnce(
      new Promise((_, reject) => {
        failClaim = reject;
      }),
    );
    const runner = makeRunner("small-archive");
    const running = runner.start();
    await flush();
    const stopping = runner.stop();
    const settled = Promise.all([running, stopping]);
    failClaim(new Error("Database connection closed"));
    await expect(settled).resolves.toEqual([undefined, undefined]);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
