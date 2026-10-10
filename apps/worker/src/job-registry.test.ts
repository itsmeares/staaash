import { beforeEach, describe, expect, it, vi } from "vitest";

const ensureBackgroundJobScheduled = vi.fn();
const instanceFindUnique = vi.fn();

vi.mock("@staaash/db/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/jobs")>()),
  ensureBackgroundJobScheduled,
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    instance: { findUnique: instanceFindUnique },
    systemSettings: { findUnique: vi.fn(async () => null) },
  }),
}));

const { schedulePeriodicJobs, scheduleNextPeriodicRun } =
  await import("./job-registry.js");

const updateCheckCalls = () =>
  ensureBackgroundJobScheduled.mock.calls
    .map(([args]) => args as { kind: string; runAt: Date; windowEnd: Date })
    .filter((args) => args.kind === "update.check");

describe("update check scheduling", () => {
  const now = new Date("2026-10-10T12:20:00.000Z");
  // Installed at 09:47:30, so the hourly check lands at :47:30.
  const createdAt = new Date("2026-01-01T09:47:30.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks right away on start, deduping only against due jobs", async () => {
    instanceFindUnique.mockResolvedValue({
      createdAt,
      lastUpdateCheckAt: null,
    });

    await schedulePeriodicJobs(now, { runMissingImmediately: true });

    // A future hourly job has runAt > windowEnd, so it cannot swallow this one.
    expect(updateCheckCalls()).toEqual([
      expect.objectContaining({ runAt: now, windowEnd: now }),
    ]);
  });

  it("waits for the hourly slot when a check ran a moment ago", async () => {
    instanceFindUnique.mockResolvedValue({
      createdAt,
      lastUpdateCheckAt: new Date(now.getTime() - 20_000),
    });

    await schedulePeriodicJobs(now, { runMissingImmediately: true });

    expect(updateCheckCalls()).toEqual([
      expect.objectContaining({ runAt: new Date("2026-10-10T12:47:30.000Z") }),
    ]);
  });

  it("schedules the next hourly check at the install's own minute", async () => {
    instanceFindUnique.mockResolvedValue({ createdAt, lastUpdateCheckAt: now });

    await scheduleNextPeriodicRun(
      "update.check",
      new Date("2026-10-10T12:50:00.000Z"),
    );

    expect(updateCheckCalls()).toEqual([
      expect.objectContaining({ runAt: new Date("2026-10-10T13:47:30.000Z") }),
    ]);
  });
});
