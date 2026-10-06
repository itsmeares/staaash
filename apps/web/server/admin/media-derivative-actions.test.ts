import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findDerivative: vi.fn(),
  updateMany: vi.fn(),
  findJob: vi.fn(),
  cancelBackgroundJob: vi.fn(),
  markDerivativeStale: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({
    mediaDerivative: {
      findUnique: mocks.findDerivative,
      updateMany: mocks.updateMany,
    },
    backgroundJob: { findFirst: mocks.findJob },
  }),
}));
vi.mock("@staaash/db/jobs", () => ({
  cancelBackgroundJob: mocks.cancelBackgroundJob,
}));
vi.mock("@staaash/db/media-derivatives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/media-derivatives")>()),
  markDerivativeStale: mocks.markDerivativeStale,
}));
vi.mock("@/server/auth/guards", () => ({
  requireOwnerPageSession: async () => ({ user: { id: "owner-1" } }),
}));
vi.mock("@/server/settings", () => ({ getSystemSettings: vi.fn() }));
vi.mock("@/server/storage", () => ({ getStoragePath: vi.fn() }));
vi.mock("@/server/durable-storage-mutation", () => ({
  runDurableStorageMutation: vi.fn(),
}));
vi.mock("@staaash/db/storage-mutation-executor", () => ({
  calculateStorageFileChecksum: vi.fn(),
}));

import { cancelDerivative } from "@/app/admin/jobs/media-derivative-actions";

describe("cancelDerivative", () => {
  let formData: FormData;

  beforeEach(() => {
    vi.resetAllMocks();
    formData = new FormData();
    formData.set("id", "derivative-1");
    mocks.findDerivative.mockResolvedValue({
      fileId: "file-1",
      status: "processing",
    });
    mocks.findJob.mockResolvedValue({ id: "job-1" });
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it("leaves derivative settlement to job cancellation", async () => {
    await expect(cancelDerivative({}, formData)).resolves.toEqual({
      success: true,
    });

    expect(mocks.cancelBackgroundJob).toHaveBeenCalledWith({
      jobId: "job-1",
      actorUserId: "owner-1",
    });
    expect(mocks.markDerivativeStale).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/admin/jobs");
  });

  it("returns an action error if the job became terminal", async () => {
    mocks.cancelBackgroundJob.mockRejectedValue(
      new Error("Only queued or running jobs can be cancelled."),
    );

    await expect(cancelDerivative({}, formData)).resolves.toEqual({
      error: "Only queued or running jobs can be cancelled.",
    });
    expect(mocks.markDerivativeStale).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each(["queued", "processing"])(
    "guards the orphan update against changes to its %s status",
    async (status) => {
      mocks.findDerivative.mockResolvedValue({ fileId: "file-1", status });
      mocks.findJob.mockResolvedValue(null);

      await expect(cancelDerivative({}, formData)).resolves.toEqual({
        success: true,
      });

      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { id: "derivative-1", status: { in: ["queued", "processing"] } },
        data: { status: "stale", storageKey: null, sizeBytes: null },
      });
      expect(mocks.cancelBackgroundJob).not.toHaveBeenCalled();
      expect(mocks.markDerivativeStale).not.toHaveBeenCalled();
    },
  );

  it("does not force a stale update when the guarded update matches no rows", async () => {
    mocks.findJob.mockResolvedValue(null);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(cancelDerivative({}, formData)).resolves.toEqual({
      success: true,
    });
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.markDerivativeStale).not.toHaveBeenCalled();
  });
});
