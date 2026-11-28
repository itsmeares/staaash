import { describe, expect, it } from "vite-plus/test";

import { decodeTextPage, textSourceOf } from "./text";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("decodeTextPage", () => {
  it("leaves a character cut by the page end for the next page", () => {
    // "é" is two bytes; the page ends after the first one.
    const page = decodeTextPage(bytes("café").subarray(0, 4), true);
    expect(page).toEqual({ text: "caf", end: 3 });
  });

  it("skips the tail of a character cut at the page start", () => {
    const page = decodeTextPage(bytes("\u{1F600}ok").subarray(2), false);
    expect(page).toEqual({ text: "ok", end: 4 });
  });

  it("keeps a whole character that ends the page", () => {
    expect(decodeTextPage(bytes("naïve €"), true)?.text).toBe("naïve €");
  });

  it("refuses binary bytes", () => {
    expect(
      decodeTextPage(new Uint8Array([0x50, 0x4b, 0, 3]), false),
    ).toBeNull();
    expect(
      decodeTextPage(new Uint8Array([0xff, 0xfe, 0x41]), false),
    ).toBeNull();
  });
});

describe("textSourceOf", () => {
  it.each([
    ["Report.PDF", "application/octet-stream", "pdf"],
    ["Budget.xlsx", "application/zip", "office"],
    ["Notes.odt", "application/vnd.oasis.opendocument.text", "office"],
    ["Book.epub", "application/epub+zip", "epub"],
    ["Saved page.htm", "text/html; charset=utf-8", "html"],
    ["Scan.heic", "application/octet-stream", "image"],
    ["Receipt.jpg", "image/jpeg", "image"],
    ["Logo.svg", "image/svg+xml", null],
    ["Song.mp3", "audio/mpeg", null],
    ["Clip.mov", "video/quicktime", null],
    ["main.rs", "application/octet-stream", "text"],
  ] as const)("reads %s (%s) as %s", (name, mimeType, source) => {
    expect(textSourceOf({ name, mimeType })).toBe(source);
  });
});
