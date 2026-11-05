import { describe, expect, it } from "vite-plus/test";
import {
  canHaveThumbnail,
  isHeicFile,
  resolveUploadMimeType,
  resolveViewerKind,
} from "./media-types.js";

describe("upload type from the file name", () => {
  it.each([
    ["Photo.PNG", "application/octet-stream", "image/png"],
    ["clip.mp4", "application/octet-stream", "video/mp4"],
    ["clip.mov", "", "video/quicktime"],
    ["song.mp3", "application/octet-stream", "audio/mpeg"],
    ["scan.pdf", "application/octet-stream", "application/pdf"],
    ["notes.txt", "application/octet-stream", "text/plain"],
    ["clip.mp4", "video/webm", "video/webm"],
    ["page.html", "application/octet-stream", "application/octet-stream"],
    ["logo.svg", "application/octet-stream", "application/octet-stream"],
    ["archive.png.zip", "", "application/octet-stream"],
    ["png", "", "application/octet-stream"],
  ])("stores %s sent as %j as %s", (name, mime, expected) => {
    expect(resolveUploadMimeType(mime, name)).toBe(expected);
  });
});

describe("HEIC recognition", () => {
  it.each([
    ["photo.HEIC", "", "image/heic"],
    ["photo.heif", "application/octet-stream", "image/heif"],
    ["photo.HeIc", " APPLICATION/OCTET-STREAM; charset=binary", "image/heic"],
    ["photo.heic", "image/jpeg", "image/jpeg"],
    ["photo.heic", "application/pdf", "application/pdf"],
    ["photo.jpg", "", "image/jpeg"],
    ["file.constructor", "", "application/octet-stream"],
    ["heic", "", "application/octet-stream"],
    ["heif", "application/octet-stream", "application/octet-stream"],
  ])("stores the upload type for %s and %s", (name, mime, expected) => {
    expect(resolveUploadMimeType(mime, name)).toBe(expected);
  });

  it.each([
    ["photo.HEIC", "application/octet-stream"],
    ["photo.heif", ""],
    ["photo.bin", " IMAGE/HEIC; charset=binary "],
    ["photo.bin", "image/heif-sequence"],
  ])("recognizes old photos without rewriting %s", (name, mimeType) => {
    expect(resolveViewerKind(mimeType, name)).toBe("image");
    expect(canHaveThumbnail(mimeType, name)).toBe(true);
    expect(isHeicFile({ mimeType, name })).toBe(true);
  });

  it("preserves declared viewer types and rejects active SVG thumbnails", () => {
    expect(resolveViewerKind("application/pdf", "photo.heic")).toBe("pdf");
    expect(resolveViewerKind("text/plain", "photo.heic")).toBe("text");
    expect(
      resolveViewerKind("application/octet-stream", "notes.txt"),
    ).toBeNull();
    expect(resolveViewerKind("application/octet-stream", "heic")).toBeNull();
    expect(
      canHaveThumbnail(" IMAGE/SVG+XML; charset=utf-8 ", "photo.svg"),
    ).toBe(false);
  });

  it.each(["image/jpeg", "image/png", "image/svg+xml", "application/pdf"])(
    "does not decode declared %s bytes as HEIC based on the name",
    (mimeType) => {
      expect(isHeicFile({ mimeType, name: "photo.heic" })).toBe(false);
    },
  );
});
