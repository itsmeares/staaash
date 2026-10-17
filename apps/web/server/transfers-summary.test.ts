import { describe, expect, it } from "vite-plus/test";

import { summarize } from "@/app/(workspace)/transfers";
import type { UploadingFile } from "@/app/(workspace)/transfer-context";

const upload = (
  status: UploadingFile["status"],
  size: number,
  transferredBytes: number,
  speed = 0,
): UploadingFile => ({
  clientKey: `${status}-${size}`,
  storageMutationKey: "k",
  name: "f",
  size,
  status,
  progress: 0,
  transferredBytes,
  speed,
});

describe("summarize", () => {
  it("counts finished bytes as sent and leaves failed uploads out", () => {
    const summary = summarize([
      upload("done", 100, 100),
      upload("uploading", 300, 100, 50),
      upload("error", 1000, 0),
    ]);
    expect(summary.total).toBe(2);
    expect(summary.percent).toBe(50);
    expect(summary.failed).toHaveLength(1);
    expect(summary.eta).toBe("4 seconds left");
  });

  it("is empty without uploads", () => {
    expect(summarize([])).toMatchObject({ total: 0, percent: 0, eta: "" });
  });
});
