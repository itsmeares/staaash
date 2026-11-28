import { describe, expect, it } from "vite-plus/test";

import { runProcess } from "./process.js";

const stall = (signal: AbortSignal) =>
  runProcess(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
    signal,
  });

describe("runProcess", () => {
  it("stops a program at a timeout signal and says it timed out", async () => {
    // As the reader combines them: the job's signal and its own time limit.
    const signal = AbortSignal.any([
      new AbortController().signal,
      AbortSignal.timeout(100),
    ]);
    await expect(stall(signal)).rejects.toMatchObject({
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
