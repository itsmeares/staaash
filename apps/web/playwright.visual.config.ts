import path from "node:path";

import { defineConfig } from "@playwright/test";

import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: path.resolve(__dirname, "e2e", "visual"),
  testIgnore: [],
  timeout: 180_000,
  retries: 0,
  snapshotPathTemplate: path.join(
    __dirname,
    ".data",
    "visual",
    "baseline",
    "{arg}{ext}",
  ),
  outputDir: path.join(__dirname, ".data", "visual", "results"),
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
});
