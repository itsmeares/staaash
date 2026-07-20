import { describe, expect, it } from "vitest";

import {
  applyPublicShareContentPolicy,
  getPublicShareResponseMimeType,
  isPublicShareMimeSafeInline,
} from "./public-share-content-policy";

const applyPolicy = (mimeType: string, fileName = "fixture.file") =>
  applyPublicShareContentPolicy(
    new Response("fixture-bytes", {
      headers: { "content-type": getPublicShareResponseMimeType(mimeType) },
    }),
    fileName,
  );

describe("public share browser content policy", () => {
  it("normalizes case and valid parameters before exact allowlist matching", () => {
    expect(
      applyPolicy(" ImAgE/JpEg ; charset=UTF-8 ").headers.get("content-type"),
    ).toBe("image/jpeg");
    expect(
      applyPolicy('text/plain; charset="utf-8"').headers.get("content-type"),
    ).toBe("text/plain");
    expect(isPublicShareMimeSafeInline("VIDEO/MP4; codecs=avc1")).toBe(true);
  });

  it.each([
    "text/html",
    "TEXT/HTML; Charset=UTF-8",
    "application/xhtml+xml",
    "image/svg+xml",
    "ImAgE/SvG+XmL; charset=utf-8",
    "application/xml",
    "text/xml",
    "application/javascript",
    "text/javascript",
    "application/ecmascript",
    "text/ecmascript",
  ])("forces active MIME %s to a non-executable attachment", (mimeType) => {
    const headers = applyPolicy(mimeType, "active file.html").headers;

    expect(isPublicShareMimeSafeInline(mimeType)).toBe(false);
    expect(headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''active%20file.html",
    );
    expect(headers.get("content-security-policy")).toBe(
      "sandbox; default-src 'none'; form-action 'none'; base-uri 'none'",
    );
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
  });

  it.each([
    "",
    "   ",
    "image",
    "/png",
    "image/",
    "image/png; charset",
    "image/png; =utf-8",
    "image/png, text/html",
    "image/png\r\ntext/html",
    "application/x-unknown",
  ])("fails closed for unknown, empty, or malformed MIME %j", (mimeType) => {
    expect(isPublicShareMimeSafeInline(mimeType)).toBe(false);
    const headers = applyPolicy(mimeType, "unknown.bin").headers;
    expect(headers.get("content-disposition")).toBe(
      "attachment; filename*=UTF-8''unknown.bin",
    );
    expect(headers.get("content-type")).toBe("application/octet-stream");
  });

  it("keeps only the documented exact allowlist inline", () => {
    const safeInlineMimeTypes = [
      "application/pdf",
      "audio/flac",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg",
      "audio/wav",
      "audio/webm",
      "image/avif",
      "image/bmp",
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
      "text/plain",
      "video/mp4",
      "video/ogg",
      "video/webm",
    ];

    for (const mimeType of safeInlineMimeTypes) {
      const headers = applyPolicy(mimeType, "safe.file").headers;
      expect(headers.get("content-disposition")).toMatch(/^inline;/u);
      expect(headers.get("content-type")).toBe(mimeType);
      expect(headers.get("content-security-policy")).toBe(
        "sandbox; default-src 'none'; form-action 'none'; base-uri 'none'",
      );
    }
  });
});
