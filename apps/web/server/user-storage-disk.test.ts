import { describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ statfs: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  statfs: mocks.statfs,
}));

import { getInstanceDiskInfo } from "@/server/user-storage";

describe("instance disk info", () => {
  it("counts blocks reserved for root as used, like the upload check", async () => {
    mocks.statfs.mockResolvedValue({
      bsize: 1000,
      blocks: 1000,
      bfree: 300,
      bavail: 100,
    });
    await expect(getInstanceDiskInfo()).resolves.toEqual({
      capacityBytes: 1_000_000n,
      usedBytes: 900_000n,
    });
  });
});
