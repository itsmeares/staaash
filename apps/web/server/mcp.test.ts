import { describe, expect, it } from "vite-plus/test";

import { decodeTextPage } from "@/server/mcp";

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
