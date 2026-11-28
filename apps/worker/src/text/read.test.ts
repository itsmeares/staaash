import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";

const runProcess = vi.hoisted(() => vi.fn());
vi.mock("../process.js", () => ({ runProcess }));

import {
  UnreadableFileError,
  limitText,
  placePage,
  readPdfText,
  readText,
  scanPdfPage,
} from "./read.js";

const MIB = 1024 * 1024;
const output = (stdout: string | Buffer, code = 0, stderr = "") => ({
  code,
  stdout: Buffer.from(stdout),
  stderr,
  cut: false,
});

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "staaash-text-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});
beforeEach(() => runProcess.mockReset());

const file = async (name: string, bytes: string | Buffer) => {
  const target = path.join(dir, name);
  await writeFile(target, bytes);
  return target;
};

describe("limitText", () => {
  it("cuts on a character boundary at 1 MiB", () => {
    const cut = limitText(`${"a".repeat(MIB - 1)}é`);
    expect(cut.truncated).toBe(true);
    expect(cut.text).toBe("a".repeat(MIB - 1));
    expect(limitText("short")).toEqual({ text: "short", truncated: false });
  });
});

describe("placePage", () => {
  it("puts scanned text in its page and pads missing pages", () => {
    expect(placePage("one\f\fthree", 2, "two")).toBe("one\ftwo\fthree");
    expect(placePage("", 3, "three")).toBe("\f\fthree");
  });
});

describe("readText", () => {
  it("reads UTF-8 text without its byte order mark", async () => {
    const result = await readText(
      await file("notes.txt", "﻿Fatura no 42\nÇağrı"),
      "text",
      "notes.txt",
    );
    expect(result).toEqual({
      text: "Fatura no 42\nÇağrı",
      truncated: false,
      ocrPages: [],
    });
  });

  it("keeps the first 1 MiB of a long log", async () => {
    const result = await readText(
      await file("big.log", "x".repeat(3 * MIB)),
      "text",
      "big.log",
    );
    expect(result.truncated).toBe(true);
    expect(result.text).toHaveLength(MIB);
  });

  it("refuses bytes that are not text", async () => {
    await expect(
      readText(
        await file("photo.bin", Buffer.from([0x89, 0x50, 0, 1])),
        "text",
        "photo.bin",
      ),
    ).rejects.toBeInstanceOf(UnreadableFileError);
  });

  it("reads a web page's words", async () => {
    const result = await readText(
      await file("page.html", "<p>Hello <b>there</b></p><script>x()</script>"),
      "html",
      "page.html",
    );
    expect(result.text).toBe("Hello there");
  });

  it("marks a page cut short when it runs past what is read", async () => {
    const page = `<p>Hello</p><script>${"x".repeat(16 * MIB)}</script><p>more</p>`;
    const result = await readText(
      await file("long.html", page),
      "html",
      "long.html",
    );
    expect(result).toEqual({ text: "Hello", truncated: true, ocrPages: [] });
  });
});

describe("readPdfText", () => {
  it("keeps pages apart and lists the ones with no text for OCR", async () => {
    runProcess.mockResolvedValue(
      output("Page one words\f\f  12 \fLast page\f"),
    );
    const result = await readPdfText("in.pdf", new AbortController().signal);
    expect(result).toEqual({
      text: "Page one words\f\f12\fLast page",
      truncated: false,
      ocrPages: [2, 3],
    });
    expect(runProcess).toHaveBeenCalledWith(
      "pdftotext",
      ["-enc", "UTF-8", "in.pdf", "-"],
      expect.objectContaining({ maxOutputBytes: 4 * MIB }),
    );
  });

  it("drops a page cut by the output limit", async () => {
    runProcess.mockResolvedValue({
      ...output("Whole page\fHalf a pa"),
      cut: true,
    });
    const result = await readPdfText("in.pdf", new AbortController().signal);
    expect(result).toMatchObject({ text: "Whole page", truncated: true });
  });

  it("names a password protected PDF", async () => {
    runProcess.mockResolvedValue(
      output("", 1, "Command Line Error: Incorrect password"),
    );
    await expect(
      readPdfText("in.pdf", new AbortController().signal),
    ).rejects.toMatchObject({ code: "encrypted" });
  });
});

describe("scanPdfPage", () => {
  it("pipes one drawn page into Tesseract on one thread", async () => {
    const page = Buffer.from("P5 page bytes");
    runProcess
      .mockResolvedValueOnce(output(page))
      .mockResolvedValueOnce(output("Scanned  words\n\n\n\nmore\f"));
    const signal = new AbortController().signal;
    expect(await scanPdfPage("in.pdf", 3, ["eng", "tur"], signal)).toBe(
      "Scanned  words\n\nmore",
    );
    expect(runProcess.mock.calls[0]![1]).toEqual(
      expect.arrayContaining(["-f", "3", "-l", "3", "-singlefile", "in.pdf"]),
    );
    expect(runProcess.mock.calls[1]).toEqual([
      "tesseract",
      ["stdin", "stdout", "-l", "eng+tur"],
      expect.objectContaining({
        input: page,
        env: expect.objectContaining({ OMP_THREAD_LIMIT: "1" }),
      }),
    ]);
  });

  it("fails when the page cannot be drawn", async () => {
    runProcess.mockResolvedValueOnce(output("", 99));
    await expect(
      scanPdfPage("in.pdf", 1, ["eng"], new AbortController().signal),
    ).rejects.toThrow("could not draw");
  });
});
