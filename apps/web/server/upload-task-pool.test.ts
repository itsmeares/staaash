import { describe, expect, it } from "vitest";

import { UploadTaskPool } from "@/lib/transfers/upload-task-pool";

describe("UploadTaskPool", () => {
  it("never exceeds its concurrency limit", async () => {
    const pool = new UploadTaskPool(3);
    let running = 0;
    let maxRunning = 0;
    const releases: Array<() => void> = [];

    for (let index = 0; index < 6; index++) {
      await pool.waitForSlot();
      pool.start(
        () =>
          new Promise<void>((resolve) => {
            running++;
            maxRunning = Math.max(maxRunning, running);
            releases.push(() => {
              running--;
              resolve();
            });
          }),
      );

      if (releases.length === 3) {
        releases.shift()?.();
      }
    }

    while (releases.length > 0) releases.shift()?.();
    await pool.drain();

    expect(maxRunning).toBe(3);
  });

  it("surfaces the first task failure", async () => {
    const pool = new UploadTaskPool(2);
    pool.start(async () => {
      throw new Error("chunk failed");
    });

    await expect(pool.drain()).rejects.toThrow("chunk failed");
  });
});
