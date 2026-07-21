import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fileAggregate: vi.fn(),
  uploadAggregate: vi.fn(),
  findUnique: vi.fn(),
  getPrisma: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: mocks.getPrisma,
}));

import { FilesError } from "@/server/files/errors";
import {
  assertUserStorageQuotaAvailable,
  getInstanceStorageUsed,
  getUserStorageUsed,
} from "./user-storage";

describe("user storage usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({
      file: { aggregate: mocks.fileAggregate },
      uploadSession: { aggregate: mocks.uploadAggregate },
      user: { findUnique: mocks.findUnique },
    });
  });

  it("returns a user's aggregate usage and preserves bigint precision", async () => {
    mocks.fileAggregate.mockResolvedValue({
      _sum: { sizeBytes: 9_007_199_254_740_993n },
    });
    mocks.uploadAggregate.mockResolvedValue({
      _sum: { totalSizeBytes: 7n },
    });

    await expect(getUserStorageUsed("user-1")).resolves.toEqual({
      committedBytes: 9_007_199_254_740_993n,
      reservedBytes: 7n,
      usedBytes: 9_007_199_254_741_000n,
    });
    expect(mocks.fileAggregate).toHaveBeenCalledWith({
      where: { ownerUserId: "user-1" },
      _sum: { sizeBytes: true },
    });
  });

  it("uses zero for empty user and instance aggregates", async () => {
    mocks.fileAggregate.mockResolvedValue({ _sum: { sizeBytes: null } });
    mocks.uploadAggregate.mockResolvedValue({
      _sum: { totalSizeBytes: null },
    });

    await expect(getUserStorageUsed("user-1")).resolves.toEqual({
      committedBytes: 0n,
      reservedBytes: 0n,
      usedBytes: 0n,
    });
    await expect(getInstanceStorageUsed()).resolves.toBe(0n);
  });

  it("rejects uploads exceeding a configured user limit", async () => {
    mocks.findUnique.mockResolvedValue({ storageLimitBytes: 100n });
    mocks.fileAggregate.mockResolvedValue({ _sum: { sizeBytes: 99n } });
    mocks.uploadAggregate.mockResolvedValue({
      _sum: { totalSizeBytes: 0n },
    });

    await expect(
      assertUserStorageQuotaAvailable("user-1", 2n),
    ).rejects.toBeInstanceOf(FilesError);
  });

  it("preserves zero as the existing unlimited-quota convention", async () => {
    mocks.findUnique.mockResolvedValue({ storageLimitBytes: 0n });

    await expect(
      assertUserStorageQuotaAvailable("user-1", 1_000n),
    ).resolves.toBeUndefined();
    expect(mocks.fileAggregate).not.toHaveBeenCalled();
    expect(mocks.uploadAggregate).not.toHaveBeenCalled();
  });
});
