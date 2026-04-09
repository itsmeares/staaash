import { afterEach, describe, expect, it, vi } from "vitest";

const writeInstanceUpdateCheck = vi.fn();

vi.mock("@staaash/db/instance", () => ({
  writeInstanceUpdateCheck,
}));

const createJob = () =>
  ({
    id: "job-1",
    kind: "update.check",
    status: "queued",
    payloadJson: {},
    dedupeKey: null,
    runAt: new Date("2026-04-06T12:00:00.000Z"),
    lockedAt: null,
    lockedBy: null,
    attemptCount: 0,
    maxAttempts: 5,
    lastError: null,
    createdAt: new Date("2026-04-06T12:00:00.000Z"),
    updatedAt: new Date("2026-04-06T12:00:00.000Z"),
  }) as const;

describe("update check handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    delete process.env.UPDATE_CHECK_REPOSITORY;
    delete process.env.UPDATE_CHECK_TOKEN;
    process.env.APP_VERSION = "0.1.0";
  });

  it("marks update checks unavailable when no repository is configured", async () => {
    const { handleUpdateCheck } = await import("./update-check");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "unavailable",
        updateCheckMessage: "Update checks are not configured.",
        latestAvailableVersion: null,
      }),
    );
  });

  it("marks an update as available when the release version is newer", async () => {
    process.env.UPDATE_CHECK_REPOSITORY = "itsmeares/staaash";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: "v0.2.0",
        }),
      }),
    );

    const { handleUpdateCheck } = await import("./update-check");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "update-available",
        latestAvailableVersion: "0.2.0",
      }),
    );
  });

  it("marks missing releases as unavailable rather than errors", async () => {
    process.env.UPDATE_CHECK_REPOSITORY = "itsmeares/staaash";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const { handleUpdateCheck } = await import("./update-check");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "unavailable",
        latestAvailableVersion: null,
      }),
    );
  });

  it("marks transport or API failures as errors", async () => {
    process.env.UPDATE_CHECK_REPOSITORY = "itsmeares/staaash";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }),
    );

    const { handleUpdateCheck } = await import("./update-check");

    await handleUpdateCheck(createJob());

    expect(writeInstanceUpdateCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        updateCheckStatus: "error",
        latestAvailableVersion: null,
      }),
    );
  });
});
