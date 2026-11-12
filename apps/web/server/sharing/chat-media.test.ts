import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { FileSummary } from "@/server/files/types";

const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  video: vi.fn(),
  schedule: vi.fn(),
  status: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@staaash/db/media-derivatives", async (original) => ({
  ...(await original<typeof import("@staaash/db/media-derivatives")>()),
  findReadyDerivative: (_id: string, kind?: string) =>
    kind === "thumbnail" ? mocks.image() : mocks.video(),
  scheduleDerivativeGenerate: mocks.schedule,
}));
vi.mock("@/server/files/derivative-status", () => ({
  getPrivatePreviewStatus: mocks.status,
}));
vi.mock("@/server/settings", () => ({ getSystemSettings: mocks.settings }));

import { getCardPicture, getCardVideo } from "./chat-media";

const file: FileSummary = {
  id: "file",
  name: "film.mp4",
  ownerUserId: "member",
  ownerStorageId: "member",
  folderId: null,
  viewerKind: "video",
  mimeType: "video/mp4",
  sizeBytes: 1_000_000_000,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const image = {
  storageKey: "thumb.jpg",
  mimeType: "image/jpeg",
  width: 480,
  height: 270,
};
const copy = {
  storageKey: "copy.mp4",
  mimeType: "video/mp4",
  width: 1920,
  height: 1080,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.settings.mockResolvedValue({
    mediaThumbnailsEnabled: true,
    mediaPreviewEnabled: true,
    mediaPreviewThresholdBytes: 350_000_000n,
  });
  mocks.image.mockResolvedValue(image);
  mocks.video.mockResolvedValue(copy);
  mocks.status.mockResolvedValue({ status: "none" });
});

describe("card video", () => {
  it("offers the full web copy with its real size", async () => {
    expect(await getCardVideo(file)).toEqual({
      type: "video/mp4",
      width: 1920,
      height: 1080,
    });
  });

  it("offers a ready web copy even when its size is unknown", async () => {
    mocks.video.mockResolvedValue({ ...copy, width: null, height: null });
    expect(await getCardVideo(file)).toEqual({ type: "video/mp4" });
  });

  it("never offers a large original without a ready web copy", async () => {
    mocks.video.mockResolvedValue(null);
    expect(await getCardVideo(file)).toBeNull();
  });

  it("offers a small playable original without guessing its size", async () => {
    mocks.video.mockResolvedValue(null);
    expect(
      await getCardVideo({ ...file, mimeType: "video/webm", sizeBytes: 1000 }),
    ).toEqual({ type: "video/webm" });
  });

  it("skips a small original browsers cannot play", async () => {
    mocks.video.mockResolvedValue(null);
    expect(
      await getCardVideo({
        ...file,
        mimeType: "video/x-matroska",
        sizeBytes: 1000,
      }),
    ).toBeNull();
  });
});

describe("card picture", () => {
  it("uses a ready thumbnail without touching the queue", async () => {
    expect(await getCardPicture(file)).toEqual({
      type: "image/jpeg",
      width: 480,
      height: 270,
    });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("queues a missing thumbnail and waits for it", async () => {
    mocks.image.mockResolvedValueOnce(null).mockResolvedValue(image);
    expect(await getCardPicture(file)).toMatchObject({ width: 480 });
    expect(mocks.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file", kind: "thumbnail" }),
    );
  });

  it("gives up after a few seconds while the worker is busy", async () => {
    mocks.image.mockResolvedValue(null);
    mocks.status.mockResolvedValue({ status: "queued" });
    expect(await getCardPicture(file)).toBeNull();
    expect(mocks.schedule).not.toHaveBeenCalled();
  }, 5000);

  it("does not retry a thumbnail that already failed", async () => {
    mocks.image.mockResolvedValue(null);
    mocks.status.mockResolvedValue({ status: "failed" });
    expect(await getCardPicture(file)).toBeNull();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.image).toHaveBeenCalledOnce();
  });

  it("queues nothing when thumbnails are off", async () => {
    mocks.image.mockResolvedValue(null);
    mocks.settings.mockResolvedValue({ mediaThumbnailsEnabled: false });
    expect(await getCardPicture(file)).toBeNull();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("stops waiting when the request is cancelled", async () => {
    mocks.image.mockResolvedValue(null);
    const controller = new AbortController();
    controller.abort();
    await expect(getCardPicture(file, controller.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
  });

  it("has no picture for files without a thumbnail", async () => {
    expect(
      await getCardPicture({
        ...file,
        viewerKind: null,
        name: "notes.txt",
        mimeType: "text/plain",
      }),
    ).toBeNull();
    expect(mocks.image).not.toHaveBeenCalled();
  });
});
