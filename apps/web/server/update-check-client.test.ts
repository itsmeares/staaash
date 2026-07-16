import { describe, expect, it, vi } from "vitest";

import { waitForUpdateCheck } from "@/lib/update-check-client";

const createResponse = (body: unknown, ok = true) =>
  ({
    ok,
    json: async () => body,
  }) as Response;

const updateStatus = {
  currentVersion: "1.0.0-rc.4",
  repository: "itsmeares/staaash",
  lastUpdateCheckAt: "2026-07-16T12:00:00.000Z",
  updateCheckStatus: "up-to-date" as const,
  updateCheckMessage: "Instance is up to date.",
  latestAvailableVersion: "1.0.0-rc.4",
};

describe("waitForUpdateCheck", () => {
  it("polls until the job succeeds", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(
        createResponse({
          job: { id: "job-1", status: "running", lastError: null },
          updateStatus,
        }),
      )
      .mockResolvedValueOnce(
        createResponse({
          job: { id: "job-1", status: "succeeded", lastError: null },
          updateStatus,
        }),
      );
    const wait = vi.fn().mockResolvedValue(undefined);

    await expect(
      waitForUpdateCheck({
        jobId: "job-1",
        fetchStatus,
        wait,
        maxAttempts: 2,
      }),
    ).resolves.toMatchObject({
      job: { status: "succeeded" },
      updateStatus: { latestAvailableVersion: "1.0.0-rc.4" },
    });
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("surfaces terminal worker failures", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(
      createResponse({
        job: {
          id: "job-1",
          status: "failed",
          lastError: "Worker stopped.",
        },
        updateStatus,
      }),
    );

    await expect(
      waitForUpdateCheck({ jobId: "job-1", fetchStatus }),
    ).rejects.toThrow("Worker stopped.");
  });

  it("surfaces API errors", async () => {
    const fetchStatus = vi
      .fn()
      .mockResolvedValue(createResponse({ error: "Not found." }, false));

    await expect(
      waitForUpdateCheck({ jobId: "job-1", fetchStatus }),
    ).rejects.toThrow("Not found.");
  });

  it("stops after the configured polling bound", async () => {
    const fetchStatus = vi.fn().mockResolvedValue(
      createResponse({
        job: { id: "job-1", status: "queued", lastError: null },
        updateStatus,
      }),
    );

    await expect(
      waitForUpdateCheck({
        jobId: "job-1",
        fetchStatus,
        maxAttempts: 2,
        wait: async () => undefined,
      }),
    ).rejects.toThrow("still running");
    expect(fetchStatus).toHaveBeenCalledTimes(2);
  });
});
