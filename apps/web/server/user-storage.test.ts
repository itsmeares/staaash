import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
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
      file: { aggregate: mocks.aggregate },
      user: { findUnique: mocks.findUnique },
    });
  });

  it("returns a user's aggregate usage and preserves bigint precision", async () => {
    mocks.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 9_007_199_254_740_993n },
    });

    await expect(getUserStorageUsed("user-1")).resolves.toEqual({
      usedBytes: 9_007_199_254_740_993n,
    });
    expect(mocks.aggregate).toHaveBeenCalledWith({
      where: { ownerUserId: "user-1" },
      _sum: { sizeBytes: true },
    });
  });

  it("uses zero for empty user and instance aggregates", async () => {
    mocks.aggregate.mockResolvedValue({ _sum: { sizeBytes: null } });

    await expect(getUserStorageUsed("user-1")).resolves.toEqual({
      usedBytes: 0n,
    });
    await expect(getInstanceStorageUsed()).resolves.toBe(0n);
  });

  it("rejects uploads exceeding a configured user limit", async () => {
    mocks.findUnique.mockResolvedValue({ storageLimitBytes: 100n });
    mocks.aggregate.mockResolvedValue({ _sum: { sizeBytes: 99n } });

    await expect(
      assertUserStorageQuotaAvailable("user-1", 2n),
    ).rejects.toBeInstanceOf(FilesError);
  });
});
