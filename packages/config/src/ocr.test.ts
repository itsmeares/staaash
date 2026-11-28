import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { OCR_LANGUAGES, automaticOcrMode, scanPlan } from "./ocr";

const tools = {
  pdftotext: "25.12.0",
  pdftoppm: true,
  tesseract: "5.5.2",
  languages: ["eng", "tur"],
  ffmpeg: true,
};

describe("OCR", () => {
  it("offers exactly the models the Docker image downloads", () => {
    const models = readFileSync(
      path.resolve(import.meta.dirname, "../../../scripts/tessdata.sha256"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => line.split(/\s+/)[1]!.replace(".traineddata", ""));
    expect(models.sort()).toEqual(Object.keys(OCR_LANGUAGES).sort());
  });

  it("scans PDFs by default only with two or more CPU cores", () => {
    expect(automaticOcrMode(1)).toBe("off");
    expect(automaticOcrMode(2)).toBe("pdf");
  });

  it("scans only what the setting asks and the worker can do", () => {
    expect(scanPlan("all", ["tur", "eng", "deu"], tools)).toEqual({
      sources: ["pdf", "image"],
      languages: ["eng", "tur"],
    });
    expect(scanPlan("pdf", ["eng"], tools).sources).toEqual(["pdf"]);
    expect(scanPlan("off", ["eng"], tools).sources).toEqual([]);
    expect(scanPlan("all", ["deu"], tools).sources).toEqual([]);
    expect(
      scanPlan("all", ["eng"], { ...tools, tesseract: null }).sources,
    ).toEqual([]);
    expect(
      scanPlan("all", ["eng"], { ...tools, ffmpeg: false, pdftoppm: false })
        .sources,
    ).toEqual([]);
  });
});
