import { open, readFile } from "node:fs/promises";
import path from "node:path";

import type { TextTools } from "@staaash/config/ocr";
import { decodeTextPage, type FileTextSource } from "@staaash/config/text";
import { FILE_TEXT_MAX_BYTES } from "@staaash/db/file-text";

import { runProcess } from "../process.js";
import {
  type ExtractedText,
  epubText,
  htmlText,
  officeText,
  tidyText,
} from "./extract.js";

/** Web pages are mostly markup; more than this is never needed for 1 MiB of text. */
const MAX_HTML_BYTES = 16 * 1024 * 1024;
const MAX_PDF_OUTPUT_BYTES = 4 * FILE_TEXT_MAX_BYTES;
const MAX_PAGE_IMAGE_BYTES = 64 * 1024 * 1024;
/** About 300 dpi for an A4 page, which Tesseract reads best. */
const SCAN_PIXELS = 3500;

/** Cuts text to the size kept per file, on a character boundary. */
export const limitText = (text: string) => {
  if (Buffer.byteLength(text) <= FILE_TEXT_MAX_BYTES) {
    return { text, truncated: false };
  }
  return {
    text:
      decodeTextPage(Buffer.from(text).subarray(0, FILE_TEXT_MAX_BYTES), true)
        ?.text ?? "",
    truncated: true,
  };
};

const readStart = async (file: string, bytes: number) => {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

export class UnreadableFileError extends Error {
  constructor(readonly code: "encrypted" | "unreadable" | "not-text") {
    super(`The file is ${code}.`);
  }
}

export type ReadResult = {
  text: string;
  truncated: boolean;
  /** Pages, or the picture, left for OCR. */
  ocrPages: number[];
};

/** The PDF's text layer, page by page, and the pages that have none. */
export const readPdfText = async (file: string, signal: AbortSignal) => {
  const result = await runProcess("pdftotext", ["-enc", "UTF-8", file, "-"], {
    signal,
    maxOutputBytes: MAX_PDF_OUTPUT_BYTES,
  });
  if (result.code !== 0 && !result.cut) {
    throw new UnreadableFileError(
      result.code === 3 || /password/i.test(result.stderr)
        ? "encrypted"
        : "unreadable",
    );
  }
  // Every page ends with a form feed; a cut page is dropped.
  const pages = result.stdout.toString("utf8").split("\f").slice(0, -1);
  const kept = limitText(pages.map(tidyText).join("\f"));
  const keptPages = kept.text.split("\f").length;
  return {
    ...kept,
    truncated: kept.truncated || result.cut,
    ocrPages: pages.flatMap((page, index) =>
      index < keptPages && page.replace(/\s/g, "").length < 3
        ? [index + 1]
        : [],
    ),
  };
};

const readMarkup = async (
  file: string,
  source: "html" | "epub" | "office",
  name: string,
): Promise<ExtractedText> => {
  if (source === "html") {
    const start = await readStart(file, MAX_HTML_BYTES + 1);
    return {
      text: htmlText(
        new TextDecoder().decode(start.subarray(0, MAX_HTML_BYTES)),
      ),
      cut: start.length > MAX_HTML_BYTES,
    };
  }
  const zip = await readFile(file);
  return source === "epub"
    ? epubText(zip)
    : officeText(zip, path.extname(name).slice(1).toLowerCase());
};

/** Reads what a file says without OCR. */
export const readText = async (
  file: string,
  source: Exclude<FileTextSource, "pdf" | "image">,
  name: string,
): Promise<ReadResult> => {
  if (source === "text") {
    const start = await readStart(file, FILE_TEXT_MAX_BYTES + 4);
    const page = decodeTextPage(start, true);
    if (!page) throw new UnreadableFileError("not-text");
    return { ...limitText(page.text.replace(/^\uFEFF/, "")), ocrPages: [] };
  }
  const { text, cut } = await readMarkup(file, source, name);
  const kept = limitText(text);
  return { ...kept, truncated: kept.truncated || cut, ocrPages: [] };
};

const ocr = async (image: Buffer, languages: string[], signal: AbortSignal) => {
  const result = await runProcess(
    "tesseract",
    ["stdin", "stdout", "-l", languages.join("+")],
    {
      input: image,
      signal,
      maxOutputBytes: FILE_TEXT_MAX_BYTES,
      // One thread: on a small server OCR must leave room for the drive.
      env: { ...process.env, OMP_THREAD_LIMIT: "1" },
    },
  );
  if (result.code !== 0) {
    throw new Error(`tesseract exited with code ${String(result.code)}.`);
  }
  return tidyText(result.stdout.toString("utf8").replaceAll("\f", ""));
};

const image = async (command: string, args: string[], signal: AbortSignal) => {
  const result = await runProcess(command, args, {
    signal,
    maxOutputBytes: MAX_PAGE_IMAGE_BYTES,
  });
  if (result.code !== 0 || result.cut || result.stdout.length === 0) {
    throw new Error(`${command} could not draw the page.`);
  }
  return result.stdout;
};

/**
 * OCR of one PDF page, drawn as a grey PGM and piped to Tesseract. Not PNG:
 * compressing the page took pdftoppm 15 seconds, four times the OCR itself.
 */
export const scanPdfPage = async (
  file: string,
  page: number,
  languages: string[],
  signal: AbortSignal,
) =>
  ocr(
    await image(
      "pdftoppm",
      [
        "-f",
        String(page),
        "-l",
        String(page),
        "-scale-to",
        String(SCAN_PIXELS),
        "-gray",
        "-singlefile",
        file,
      ],
      signal,
    ),
    languages,
    signal,
  );

/** OCR of a picture. FFmpeg decodes every kind, HEIC included, the same way thumbnails do. */
export const scanPicture = async (
  file: string,
  languages: string[],
  signal: AbortSignal,
) =>
  ocr(
    await image(
      "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        `scale=w='min(iw,${SCAN_PIXELS})':h='min(ih,${SCAN_PIXELS})':force_original_aspect_ratio=decrease,format=gray`,
        "-f",
        "image2pipe",
        "-c:v",
        "pgm",
        "-",
      ],
      signal,
    ),
    languages,
    signal,
  );

/** Puts one page's scanned text in its place among the PDF's pages. */
export const placePage = (text: string, page: number, pageText: string) => {
  const pages = text.split("\f");
  while (pages.length < page) pages.push("");
  pages[page - 1] = pageText;
  return pages.join("\f");
};

const probe = async (command: string, args: string[]) => {
  try {
    const result = await runProcess(command, args, {
      timeoutMs: 10_000,
      maxOutputBytes: 64 * 1024,
    });
    return `${result.stdout.toString()}\n${result.stderr}`;
  } catch {
    return null;
  }
};

const versionOf = (output: string | null) =>
  output === null ? null : (/\d+\.\d+(?:\.\d+)?/.exec(output)?.[0] ?? "");

let tools: TextTools = {
  pdftotext: null,
  pdftoppm: false,
  tesseract: null,
  languages: [],
  ffmpeg: false,
};

/** Finds Poppler and Tesseract. Missing ones turn off what needs them. */
export const detectTextTools = async () => {
  const [pdftotext, pdftoppm, tesseract, languages, ffmpeg] = await Promise.all(
    [
      probe("pdftotext", ["-v"]),
      probe("pdftoppm", ["-v"]),
      probe("tesseract", ["--version"]),
      probe("tesseract", ["--list-langs"]),
      probe("ffmpeg", ["-version"]),
    ],
  );
  tools = {
    pdftotext: versionOf(pdftotext),
    pdftoppm: pdftoppm !== null,
    tesseract: versionOf(tesseract),
    languages:
      tesseract === null
        ? []
        : (languages ?? "")
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /^\w+$/.test(line) && line !== "osd"),
    ffmpeg: ffmpeg !== null,
  };
  return tools;
};

export const getTextTools = () => tools;
