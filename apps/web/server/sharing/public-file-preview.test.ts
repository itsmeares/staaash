import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaDerivativeRecord } from "@staaash/db/media-derivatives";

import type { FileSummary } from "@/server/files/types";

const mocks = vi.hoisted(() => ({
  findReadyDerivative: vi.fn(),
  getStoragePath: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  stat: mocks.stat,
}));

vi.mock("@staaash/db/media-derivatives", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@staaash/db/media-derivatives")>()),
  findReadyDerivative: mocks.findReadyDerivative,
}));

vi.mock("@/server/storage", () => ({
  getStoragePath: mocks.getStoragePath,
}));

const fixedNow = new Date("2026-07-20T12:00:00.000Z");

const videoFile: FileSummary = {
  id: "video-1",
  ownerUserId: "member-1",
  ownerStorageId: "member-1",
  folderId: "folder-1",
  name: "source.mov",
  mimeType: "video/quicktime",
  sizeBytes: 10,
  viewerKind: "video",
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const makeDerivative = (
  overrides: Partial<MediaDerivativeRecord> = {},
): MediaDerivativeRecord => ({
  id: "derivative-1",
  fileId: videoFile.id,
  kind: "preview",
  profile: "preview-1080p",
  status: "ready",
  storageKey: "derivatives/member-1/video-1/preview-1080p.mp4",
  mimeType: "video/mp4",
  sizeBytes: 10n,
  width: 1280,
  height: 720,
  durationSeconds: 2,
  videoCodec: "h264",
  audioCodec: "aac",
  error: null,
  pinnedByAdmin: false,
  lastViewedAt: null,
  lastSharedAt: null,
  generatedAt: fixedNow,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  ...overrides,
});

describe("public share file preview metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStoragePath.mockReturnValue("C:\\temp\\preview.mp4");
    mocks.stat.mockResolvedValue({ isFile: () => true });
  });

  it("exposes only a safe emitted MIME for a ready readable derivative", async () => {
    mocks.findReadyDerivative.mockResolvedValue(
      makeDerivative({ mimeType: "ViDeO/Mp4; codecs=avc1" }),
    );
    const { getPublicShareFilePreview } = await import("./public-file-preview");

    const preview = await getPublicShareFilePreview(videoFile);

    expect(preview).toEqual({ safeInlineMimeType: "video/mp4" });
    expect(preview).not.toHaveProperty("storageKey");
    expect(preview).not.toHaveProperty("id");
  });

  it.each(["failed", "queued", "processing", "stale"])(
    "ignores a %s derivative record",
    async (status) => {
      mocks.findReadyDerivative.mockResolvedValue(makeDerivative({ status }));
      const { getPublicShareFilePreview } =
        await import("./public-file-preview");

      await expect(getPublicShareFilePreview(videoFile)).resolves.toBeNull();
    },
  );

  it.each([
    ["missing record", null],
    ["missing storage key", makeDerivative({ storageKey: null })],
    ["missing size", makeDerivative({ sizeBytes: null })],
  ])("ignores a %s", async (_label, derivative) => {
    mocks.findReadyDerivative.mockResolvedValue(derivative);
    const { getPublicShareFilePreview } = await import("./public-file-preview");

    await expect(getPublicShareFilePreview(videoFile)).resolves.toBeNull();
  });

  it("ignores a derivative whose storage object is missing", async () => {
    mocks.findReadyDerivative.mockResolvedValue(makeDerivative());
    mocks.stat.mockRejectedValue(new Error("missing"));
    const { getPublicShareFilePreview } = await import("./public-file-preview");

    await expect(getPublicShareFilePreview(videoFile)).resolves.toBeNull();
  });

  it.each(["video/quicktime", "video/mp4; charset", ""])(
    "marks ready MIME %j as not native-inline without exposing it",
    async (mimeType) => {
      mocks.findReadyDerivative.mockResolvedValue(makeDerivative({ mimeType }));
      const { getPublicShareFilePreview } =
        await import("./public-file-preview");

      await expect(getPublicShareFilePreview(videoFile)).resolves.toEqual({
        safeInlineMimeType: null,
      });
    },
  );

  it("does not query derivatives for other viewer kinds", async () => {
    const { getPublicShareFilePreview } = await import("./public-file-preview");

    await expect(
      getPublicShareFilePreview({ ...videoFile, viewerKind: "image" }),
    ).resolves.toBeNull();
    expect(mocks.findReadyDerivative).not.toHaveBeenCalled();
  });
});
