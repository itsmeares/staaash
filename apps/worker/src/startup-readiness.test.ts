import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  areMigrationsApplied: vi.fn(),
  isStorageProtocolReady: vi.fn(),
  writeHeartbeat: vi.fn(),
}));

vi.mock("@staaash/db/health", () => ({
  areMigrationsApplied: mocks.areMigrationsApplied,
}));
vi.mock("./storage-protocol-cutover.js", () => ({
  isStorageProtocolReady: mocks.isStorageProtocolReady,
}));
vi.mock("./storage-maintenance.js", () => ({
  writeHeartbeat: mocks.writeHeartbeat,
}));

import {
  waitForMigrations,
  waitForStorageProtocolReady,
} from "./startup-readiness.js";

describe("worker startup readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("recovers from a transient readiness query failure", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.isStorageProtocolReady
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(true);
    const runMaintenance = vi.fn().mockResolvedValue(undefined);

    await waitForStorageProtocolReady({
      runMaintenance,
      heartbeatPath: "heartbeat.json",
      retryDelayMs: 0,
    });

    expect(runMaintenance).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      "[worker] Storage readiness probe failed; retrying.",
      { error: "database unavailable" },
    );
    warning.mockRestore();
  });

  it("writes heartbeat and backs off while storage stays unready", async () => {
    mocks.isStorageProtocolReady
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await waitForStorageProtocolReady({
      runMaintenance: vi.fn().mockResolvedValue(undefined),
      heartbeatPath: "heartbeat.json",
      retryDelayMs: 0,
    });

    expect(mocks.writeHeartbeat).toHaveBeenCalledWith("heartbeat.json");
  });

  it("waits for migrations that have not started or not finished", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.areMigrationsApplied
      .mockRejectedValueOnce(
        new Error('relation "_prisma_migrations" does not exist'),
      )
      .mockRejectedValueOnce(
        new Error('relation "_prisma_migrations" does not exist'),
      )
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await waitForMigrations({
      heartbeatPath: "heartbeat.json",
      retryDelayMs: 0,
    });

    expect(mocks.areMigrationsApplied).toHaveBeenCalledTimes(4);
    expect(mocks.writeHeartbeat).toHaveBeenCalledTimes(3);
    expect(info.mock.calls).toEqual([
      [
        "[worker] Waiting for database migrations.",
        { reason: 'relation "_prisma_migrations" does not exist' },
      ],
      [
        "[worker] Waiting for database migrations.",
        { reason: "Migrations are still running." },
      ],
      ["[worker] Database migrations done."],
    ]);
    info.mockRestore();
  });

  it("starts at once when the migrations are already done", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.areMigrationsApplied.mockResolvedValueOnce(true);

    await waitForMigrations({
      heartbeatPath: "heartbeat.json",
      retryDelayMs: 0,
    });

    expect(mocks.writeHeartbeat).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });
});
