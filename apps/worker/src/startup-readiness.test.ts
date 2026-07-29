import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isStorageProtocolReady: vi.fn(),
  writeHeartbeat: vi.fn(),
}));

vi.mock("./storage-protocol-cutover.js", () => ({
  isStorageProtocolReady: mocks.isStorageProtocolReady,
}));
vi.mock("./storage-maintenance.js", () => ({
  writeHeartbeat: mocks.writeHeartbeat,
}));

import { waitForStorageProtocolReady } from "./startup-readiness.js";

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
});
