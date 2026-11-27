import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  listFilesToRead: vi.fn(),
  findFileToScan: vi.fn(),
  saveFileText: vi.fn(),
  saveScannedPage: vi.fn(),
  blocking: vi.fn(),
  settings: vi.fn(),
  readPdfText: vi.fn(),
  readText: vi.fn(),
  scanPdfPage: vi.fn(),
  scanPicture: vi.fn(),
  tools: vi.fn(),
}));

vi.mock("@staaash/db/client", () => ({
  getPrisma: () => ({ systemSettings: { findUnique: mocks.settings } }),
}));
vi.mock("@staaash/db/file-text", () => ({
  FILE_TEXT_MAX_BYTES: 1024 * 1024,
  FILE_TEXT_MAX_READ_BYTES: 100 * 1024 * 1024,
  listFilesToRead: mocks.listFilesToRead,
  findFileToScan: mocks.findFileToScan,
  saveFileText: mocks.saveFileText,
  saveScannedPage: mocks.saveScannedPage,
}));
vi.mock("@staaash/db/storage-mutations", () => ({
  findBlockingStorageMutationForEntity: mocks.blocking,
}));
vi.mock("../text/read.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../text/read.js")>()),
  getTextTools: mocks.tools,
  readPdfText: mocks.readPdfText,
  readText: mocks.readText,
  scanPdfPage: mocks.scanPdfPage,
  scanPicture: mocks.scanPicture,
}));

import { handleFileTextRead, nextFileTextRunAt } from "./file-text.js";

const storagePaths = {
  filesRoot: "/data/files",
  tmpRoot: "/data/files/tmp",
  heartbeatPath: "/data/heartbeat",
  pendingDeleteRoot: "/data/pending",
  uploadStagingTtlMs: 1000,
};
const context = () => ({
  signal: new AbortController().signal,
  workerId: "worker",
  storagePaths,
  emitEvent: vi.fn(),
  updateProgress: vi.fn(async () => undefined),
});
const allTools = {
  pdftotext: "25.12.0",
  pdftoppm: true,
  tesseract: "5.5.2",
  languages: ["eng", "tur"],
  ffmpeg: true,
};
const fileToRead = (id: string, overrides = {}) => ({
  id,
  ownerUserId: "owner",
  originalName: `${id}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 1000n,
  contentChecksum: `sum-${id}`,
  storageKey: `files/owner/${id}.pdf`,
  wanted: false,
  ...overrides,
});
const fileToScan = (id: string, overrides = {}) => ({
  ...fileToRead(id),
  source: "pdf",
  text: "Page one\f\fPage three",
  ocrPages: [2],
  ocrDone: 0,
  ocrLanguages: [],
  ...overrides,
});
const order: string[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  order.length = 0;
  mocks.tools.mockReturnValue(allTools);
  mocks.settings.mockResolvedValue({ ocrMode: "pdf", ocrLanguages: ["eng"] });
  mocks.blocking.mockResolvedValue(null);
  mocks.readPdfText.mockResolvedValue({
    text: "words",
    truncated: false,
    ocrPages: [],
  });
  mocks.saveFileText.mockImplementation(async (file: { id: string }) => {
    order.push(`read ${file.id}`);
  });
  mocks.saveScannedPage.mockImplementation(async (file: { id: string }) => {
    order.push(`scan ${file.id}`);
  });
});

/** Feeds the reader's queue one round at a time, then nothing. */
const rounds = (
  reads: ReturnType<typeof fileToRead>[][],
  scans: (ReturnType<typeof fileToScan> | null)[],
) => {
  for (const files of reads) mocks.listFilesToRead.mockResolvedValueOnce(files);
  mocks.listFilesToRead.mockResolvedValue([]);
  for (const file of scans) mocks.findFileToScan.mockResolvedValueOnce(file);
  mocks.findFileToScan.mockResolvedValue(null);
};

describe("reading file text", () => {
  it("reads wanted files, then wanted scans, then the rest", async () => {
    rounds(
      [
        [fileToRead("a", { wanted: true }), fileToRead("b")],
        [fileToRead("b")],
        [fileToRead("b")],
      ],
      [fileToScan("c", { wanted: true }), null, null],
    );
    mocks.scanPdfPage.mockResolvedValue("Page two");

    const result = await handleFileTextRead(null, storagePaths, context());

    expect(order).toEqual(["read a", "scan c", "read b"]);
    expect(result).toEqual({ read: 2, scanned: 1 });
    expect(mocks.saveScannedPage).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c" }),
      expect.objectContaining({
        text: "Page one\fPage two\fPage three",
        ocrDone: 1,
        ocrLanguages: ["eng"],
        finished: true,
      }),
    );
    expect(await nextFileTextRunAt(new Date(0))).toEqual(new Date(600_000));
  });

  it("leaves a file that is being moved for a later run", async () => {
    rounds([[fileToRead("moving")]], []);
    mocks.blocking.mockResolvedValueOnce({ mutation: { id: "m1" } });

    await handleFileTextRead(null, storagePaths, context());

    expect(mocks.saveFileText).not.toHaveBeenCalled();
    expect(mocks.listFilesToRead).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: ["moving"] }),
    );
  });

  it("records why a file has no text", async () => {
    mocks.tools.mockReturnValue({ ...allTools, pdftotext: null });
    rounds(
      [
        [
          fileToRead("clip", {
            originalName: "clip.mp4",
            mimeType: "video/mp4",
          }),
          fileToRead("huge", { sizeBytes: 200n * 1024n * 1024n }),
          fileToRead("paper"),
        ],
      ],
      [],
    );

    await handleFileTextRead(null, storagePaths, context());

    expect(
      mocks.saveFileText.mock.calls.map(([file, result]) => [
        file.id,
        result.status,
        result.error,
      ]),
    ).toEqual([
      ["clip", "skipped", "not-text"],
      ["huge", "skipped", "too-large"],
      ["paper", "skipped", "no-pdf-reader"],
    ]);
    expect(mocks.readPdfText).not.toHaveBeenCalled();
  });

  it("marks a PDF that cannot be read as failed and keeps going", async () => {
    const { UnreadableFileError } = await import("../text/read.js");
    rounds([[fileToRead("locked"), fileToRead("fine")]], []);
    mocks.readPdfText.mockRejectedValueOnce(
      new UnreadableFileError("encrypted"),
    );

    await handleFileTextRead(null, storagePaths, context());

    expect(
      mocks.saveFileText.mock.calls.map(([, r]) => r.error ?? r.status),
    ).toEqual(["encrypted", "ready"]);
  });

  it("waits to clear a wanted file until its scans are done, when scans are on", async () => {
    rounds([[fileToRead("scan", { wanted: true })]], []);
    mocks.readPdfText.mockResolvedValue({
      text: "\f",
      truncated: false,
      ocrPages: [1, 2],
    });
    await handleFileTextRead(null, storagePaths, context());
    expect(mocks.saveFileText.mock.calls[0]![1]).toMatchObject({
      ocrPages: [1, 2],
      finished: false,
    });

    mocks.settings.mockResolvedValue({ ocrMode: "off", ocrLanguages: ["eng"] });
    rounds([[fileToRead("scan", { wanted: true })]], []);
    await handleFileTextRead(null, storagePaths, context());
    expect(mocks.saveFileText.mock.calls[1]![1]).toMatchObject({
      finished: true,
    });
    expect(mocks.findFileToScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ sources: [] }),
    );
  });

  it("stops scanning as soon as the owner turns scans off", async () => {
    mocks.settings
      .mockResolvedValueOnce({ ocrMode: "pdf", ocrLanguages: ["eng"] })
      .mockResolvedValue({ ocrMode: "off", ocrLanguages: ["eng"] });
    rounds([[], []], [fileToScan("first")]);
    mocks.scanPdfPage.mockResolvedValue("Page two");

    await handleFileTextRead(null, storagePaths, context());

    expect(
      mocks.findFileToScan.mock.calls.map(([query]) => query.sources),
    ).toEqual([["pdf"], []]);
  });

  it("scans again from the first page when the languages change", async () => {
    mocks.settings.mockResolvedValue({
      ocrMode: "pdf",
      ocrLanguages: ["tur", "eng"],
    });
    rounds(
      [[]],
      [
        fileToScan("old", {
          ocrPages: [2, 3],
          ocrDone: 2,
          ocrLanguages: ["eng"],
        }),
      ],
    );
    mocks.scanPdfPage.mockResolvedValue("Sayfa iki");

    await handleFileTextRead(null, storagePaths, context());

    expect(mocks.scanPdfPage).toHaveBeenCalledWith(
      "/data/files/files/owner/old.pdf",
      2,
      ["eng", "tur"],
      expect.anything(),
    );
    expect(mocks.saveScannedPage.mock.calls[0]![1]).toMatchObject({
      ocrDone: 1,
      ocrLanguages: ["eng", "tur"],
      finished: false,
    });
  });

  it("leaves a page whose save failed for the job's retry, not marked failed", async () => {
    rounds([[]], [fileToScan("page")]);
    mocks.scanPdfPage.mockResolvedValue("Page two");
    mocks.saveScannedPage.mockRejectedValueOnce(new Error("database gone"));

    await expect(
      handleFileTextRead(null, storagePaths, context()),
    ).rejects.toThrow("database gone");
    expect(mocks.saveScannedPage).toHaveBeenCalledOnce();
  });

  it("marks a scan that runs too long as failed and keeps the text it has", async () => {
    rounds([[]], [fileToScan("slow")]);
    mocks.scanPdfPage.mockRejectedValue(
      new DOMException("tesseract timed out.", "TimeoutError"),
    );

    await handleFileTextRead(null, storagePaths, context());

    expect(mocks.saveScannedPage.mock.calls[0]![1]).toMatchObject({
      status: "failed",
      error: "scan-timeout",
      text: "Page one\f\fPage three",
      finished: true,
    });
  });
});
