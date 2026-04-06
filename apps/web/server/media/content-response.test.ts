import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn();
const getStoragePathMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  open: openMock,
}));

vi.mock("@/server/storage", () => ({
  getStoragePath: getStoragePathMock,
}));

const makeFile = (
  overrides: Partial<{
    id: string;
    ownerUserId: string;
    ownerUsername: string;
    folderId: string | null;
    name: string;
    mimeType: string;
    sizeBytes: number;
    viewerKind: "image" | "video" | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    storageKey: string;
    contentChecksum: string | null;
  }> = {},
) => ({
  id: "file-1",
  ownerUserId: "member-1",
  ownerUsername: "member-1",
  folderId: null,
  name: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 100,
  viewerKind: "video" as const,
  deletedAt: null,
  createdAt: new Date("2026-04-06T12:00:00.000Z"),
  updatedAt: new Date("2026-04-06T12:00:00.000Z"),
  storageKey: "library/member-1/clip.mp4",
  contentChecksum: null,
  ...overrides,
});

describe("media content response", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("closes the opened file handle when a range header is invalid", async () => {
    const fakeHandle = {
      stat: vi.fn().mockResolvedValue({ size: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(),
    };
    openMock.mockResolvedValueOnce(fakeHandle);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\clip.mp4");

    const { createInlineOriginalContentResponse, MediaContentError } =
      await import("@/server/media/content-response");

    await expect(
      createInlineOriginalContentResponse({
        request: new Request("http://localhost/content", {
          headers: {
            range: "bytes=abc-def",
          },
        }),
        file: makeFile(),
      }),
    ).rejects.toMatchObject({
      name: MediaContentError.name,
      status: 416,
      headers: {
        "content-range": "bytes */100",
      },
    });

    expect(fakeHandle.close).toHaveBeenCalledTimes(1);
    expect(fakeHandle.createReadStream).not.toHaveBeenCalled();
  });

  it("rejects unsupported viewer kinds before opening the file", async () => {
    const { createInlineOriginalContentResponse, MediaContentError } =
      await import("@/server/media/content-response");

    await expect(
      createInlineOriginalContentResponse({
        request: new Request("http://localhost/content"),
        file: makeFile({
          viewerKind: null,
        }),
      }),
    ).rejects.toMatchObject({
      name: MediaContentError.name,
      status: 404,
    });

    expect(openMock).not.toHaveBeenCalled();
    expect(getStoragePathMock).not.toHaveBeenCalled();
  });

  it("still streams successfully after handing the file descriptor to the stream", async () => {
    const fakeHandle = {
      stat: vi.fn().mockResolvedValue({ size: 11 }),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(() =>
        Readable.from([Buffer.from("hello world")]),
      ),
    };
    openMock.mockResolvedValueOnce(fakeHandle);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\clip.mp4");

    const { createInlineOriginalContentResponse } =
      await import("@/server/media/content-response");

    const response = await createInlineOriginalContentResponse({
      request: new Request("http://localhost/content"),
      file: makeFile({
        sizeBytes: 11,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("11");
    await expect(response.text()).resolves.toBe("hello world");
    expect(fakeHandle.close).not.toHaveBeenCalled();
  });
});
