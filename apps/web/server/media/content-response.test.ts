import { Readable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

const openMock = vi.fn();
const getStoragePathMock = vi.fn();
const markFileStorageMissingMock = vi.fn();
const convertHeicToJpegMock = vi.fn();

vi.mock("node:fs/promises", () => ({
  open: openMock,
}));

vi.mock("@/server/storage", () => ({
  getStoragePath: getStoragePathMock,
}));

vi.mock("@/server/files/repository", () => ({
  prismaFilesRepository: {
    markFileStorageMissing: markFileStorageMissingMock,
  },
}));

vi.mock("@/server/media/heic-converter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/server/media/heic-converter")>();
  return {
    ...actual,
    convertHeicToJpeg: convertHeicToJpegMock,
  };
});

const makeFile = (
  overrides: Partial<{
    id: string;
    ownerUserId: string;
    ownerStorageId: string;
    folderId: string | null;
    name: string;
    mimeType: string;
    sizeBytes: number;
    viewerKind: "audio" | "image" | "pdf" | "text" | "video" | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    storageKey: string;
    storageStatus: "available" | "missing";
    storageCheckedAt: Date | null;
    storageMissingAt: Date | null;
    contentChecksum: string | null;
  }> = {},
) => ({
  id: "file-1",
  ownerUserId: "member-1",
  ownerStorageId: "member-1",
  folderId: null,
  name: "clip.mp4",
  mimeType: "video/mp4",
  sizeBytes: 100,
  viewerKind: "video" as const,
  deletedAt: null,
  createdAt: new Date("2026-04-06T12:00:00.000Z"),
  updatedAt: new Date("2026-04-06T12:00:00.000Z"),
  storageKey: "files/member-1/clip.mp4",
  storageStatus: "available" as const,
  storageCheckedAt: null,
  storageMissingAt: null,
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

  it("streams successfully and closes the handed-off file descriptor", async () => {
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
    await vi.waitFor(() => {
      expect(fakeHandle.close).toHaveBeenCalledTimes(1);
    });
  });

  it("keeps private authenticated response behavior unchanged", async () => {
    const fakeHandle = {
      stat: vi.fn().mockResolvedValue({ size: 16 }),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(() =>
        Readable.from([Buffer.from("<h1>private</h1>")]),
      ),
    };
    openMock.mockResolvedValueOnce(fakeHandle);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\private.html");

    const { createInlineOriginalContentResponse } =
      await import("@/server/media/content-response");
    const response = await createInlineOriginalContentResponse({
      request: new Request("http://localhost/content"),
      file: makeFile({
        name: "private.html",
        mimeType: "text/html",
        sizeBytes: 16,
        viewerKind: "text",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''private.html",
    );
    expect(response.headers.has("content-security-policy")).toBe(false);
    expect(await response.text()).toBe("<h1>private</h1>");
  });

  it("applies public policy to emitted JPEG after HEIC conversion", async () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const fakeHandle = {
      stat: vi.fn().mockResolvedValue({ size: 12 }),
      readFile: vi.fn().mockResolvedValue(Buffer.from("heic-source")),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(),
    };
    openMock.mockResolvedValueOnce(fakeHandle);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\photo.heic");
    convertHeicToJpegMock.mockResolvedValueOnce(jpegBytes.buffer);

    const { createPublicShareContentResponse } =
      await import("@/server/media/public-share-content-response");
    const response = await createPublicShareContentResponse({
      request: new Request("http://localhost/content"),
      downloadDisabled: false,
      file: makeFile({
        name: "photo.heic",
        mimeType: "image/heic",
        sizeBytes: 12,
        viewerKind: "image",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''photo.heic",
    );
    expect(response.headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'; form-action 'none'; base-uri 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(jpegBytes);
    expect(convertHeicToJpegMock).toHaveBeenCalledWith(
      Buffer.from("heic-source"),
    );
  });

  it("does not fall back to original HEIC bytes when conversion fails", async () => {
    const fakeHandle = {
      stat: vi.fn().mockResolvedValue({ size: 12 }),
      readFile: vi.fn().mockResolvedValue(Buffer.from("heic-source")),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(),
    };
    openMock.mockResolvedValueOnce(fakeHandle);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\photo.heif");
    convertHeicToJpegMock.mockRejectedValueOnce(
      new Error("HEIF conversion failed"),
    );

    const { createPublicShareContentResponse } =
      await import("@/server/media/public-share-content-response");

    await expect(
      createPublicShareContentResponse({
        request: new Request("http://localhost/content"),
        downloadDisabled: false,
        file: makeFile({
          name: "photo.heif",
          mimeType: "image/heif",
          sizeBytes: 12,
          viewerKind: "image",
        }),
      }),
    ).rejects.toThrow("HEIF conversion failed");

    expect(fakeHandle.readFile).toHaveBeenCalledTimes(1);
    expect(fakeHandle.createReadStream).not.toHaveBeenCalled();
    expect(fakeHandle.close).toHaveBeenCalledTimes(1);
  });

  it("cancels and closes an attachment stream blocked by download policy", async () => {
    const nodeStream = new Readable({
      read() {
        // Keep stream open until policy cancellation.
      },
    });
    const destroySpy = vi.spyOn(nodeStream, "destroy");
    const fakeHandle = {
      stat: vi.fn().mockResolvedValue({ size: 16 }),
      close: vi.fn().mockResolvedValue(undefined),
      createReadStream: vi.fn(() => nodeStream),
    };
    openMock.mockResolvedValueOnce(fakeHandle);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\payload.html");

    const { createPublicShareContentResponse } =
      await import("@/server/media/public-share-content-response");

    await expect(
      createPublicShareContentResponse({
        request: new Request("http://localhost/content"),
        downloadDisabled: true,
        file: makeFile({
          name: "payload.html",
          mimeType: "text/html",
          sizeBytes: 16,
          viewerKind: "text",
        }),
      }),
    ).rejects.toMatchObject({
      code: "SHARE_DOWNLOAD_DISABLED",
      status: 403,
    });

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(fakeHandle.close).toHaveBeenCalledTimes(1);
  });

  it("marks the file missing when original bytes are gone", async () => {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    openMock.mockRejectedValueOnce(error);
    getStoragePathMock.mockReturnValueOnce("C:\\temp\\missing.mp4");
    markFileStorageMissingMock.mockResolvedValueOnce(undefined);

    const { createInlineOriginalContentResponse, MediaContentError } =
      await import("@/server/media/content-response");

    await expect(
      createInlineOriginalContentResponse({
        request: new Request("http://localhost/content"),
        file: makeFile(),
      }),
    ).rejects.toMatchObject({
      name: MediaContentError.name,
      status: 404,
    });

    expect(markFileStorageMissingMock).toHaveBeenCalledWith("file-1");
  });
});
