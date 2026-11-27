import { describe, expect, it } from "vite-plus/test";

import { runProcess } from "./process.js";

const stall = (signal: AbortSignal) =>
  runProcess(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
    signal,
  });

describe("runProcess", () => {
  it("stops a program at a timeout signal and says it timed out", async () => {
    await expect(stall(AbortSignal.timeout(100))).rejects.toMatchObject({
      name: "TimeoutError",
    });
  });

  it("says a cancelled program was aborted", async () => {
    const controller = new AbortController();
    const running = stall(controller.signal);
    controller.abort();
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});
