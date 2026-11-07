import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ statfs: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  mkdir: vi.fn(),
  statfs: mocks.statfs,
}));

import { assertPhysicalHeadroom } from "@/server/uploads/admission";

const GB = 1024n ** 3n;
const disk = (freeBytes: bigint, totalBytes = 937n * GB) => ({
  bsize: 4096,
  bavail: Number(freeBytes / 4096n),
  blocks: Number(totalBytes / 4096n),
});

describe("physical disk headroom", () => {
  beforeEach(() => mocks.statfs.mockReset());

  it("explains the free space, the margin, and how much to free", async () => {
    mocks.statfs.mockResolvedValue(disk(71n * GB));
    const error = await assertPhysicalHeadroom(0n, 1024n).catch(
      (caught: unknown) => caught,
    );
    expect(error).toMatchObject({
      code: "UPLOAD_STORAGE_CAPACITY_EXCEEDED",
      status: 507,
      details: expect.objectContaining({
        freeBytes: Number(71n * GB),
      }),
    });
    const { message } = error as Error;
    expect(message).toContain("only 71.0 GB is free");
    expect(message).toContain("10% of the disk (93.7 GB)");
    expect(message).toMatch(/Free at least 22.7 GB more/);
  });

  it("counts space that uploads in progress still need", async () => {
    mocks.statfs.mockResolvedValue(disk(71n * GB));
    const error = await assertPhysicalHeadroom(10n * GB, 1024n).catch(
      (caught: unknown) => caught,
    );
    const { message } = error as Error;
    expect(message).toContain(
      "10.0 GB still to arrive from uploads in progress",
    );
    expect(message).toContain("Free at least 32.7 GB more");
    expect(error).toMatchObject({
      details: expect.objectContaining({ marginBytes: expect.any(Number) }),
    });
  });

  it("admits an upload that leaves the margin free", async () => {
    mocks.statfs.mockResolvedValue(disk(200n * GB));
    await expect(assertPhysicalHeadroom(0n, GB)).resolves.toBeUndefined();
  });
});
