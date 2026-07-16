import { describe, expect, it } from "vitest";

import {
  calculateUploadProgress,
  UploadRateTracker,
} from "@/lib/transfers/upload-progress";

describe("upload progress", () => {
  it("calculates progress from acknowledged bytes", () => {
    expect(calculateUploadProgress(0, 100)).toBe(0);
    expect(calculateUploadProgress(49, 100)).toBe(49);
    expect(calculateUploadProgress(150, 100)).toBe(100);
  });

  it("uses a rolling window for transfer speed", () => {
    const tracker = new UploadRateTracker(0, 0, 5_000);

    expect(tracker.record(10_000, 1_000)).toBe(10_000);
    expect(tracker.record(30_000, 3_000)).toBe(10_000);
    expect(tracker.record(90_000, 9_000)).toBe(10_000);
  });
});
