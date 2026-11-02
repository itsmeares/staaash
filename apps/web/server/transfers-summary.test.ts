import { describe, expect, it } from "vite-plus/test";

import { summarize } from "@/src/workspace/transfers";
import type { UploadingFile } from "@/src/workspace/transfer-context";
import { summarizeDownloads } from "@/src/workspace/desktop-downloads";
import type { BrowserDownload } from "@staaash/config/desktop-downloads";

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

const download = (patch: Partial<BrowserDownload> = {}): BrowserDownload => ({
  id: "download",
  name: "Archive.zip",
  mimeType: "application/zip",
  receivedBytes: 40,
  totalBytes: 100,
  state: "downloading",
  canResume: false,
  ...patch,
});

it("keeps unknown-size downloads indeterminate instead of showing a false percent", () => {
  const summary = summarizeDownloads([
    download(),
    download({ totalBytes: null, receivedBytes: 200 }),
  ]);
  expect(summary.active).toHaveLength(2);
  expect(summary.percent).toBeNull();
});

it("does not let completed and failed downloads inflate active progress", () => {
  const summary = summarizeDownloads([
    download(),
    download({ state: "completed", receivedBytes: 100 }),
    download({ state: "failed", receivedBytes: 90 }),
    download({ state: "cancelled", receivedBytes: 80 }),
  ]);
  expect(summary.percent).toBe(40);
  expect(summary.completed).toHaveLength(1);
  expect(summary.failed).toHaveLength(1);
  expect(summary.cancelled).toHaveLength(1);
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
