import path from "node:path";

import { defineConfig } from "@playwright/test";

import baseConfig from "./playwright.config";

export default defineConfig({
  ...baseConfig,
  testDir: path.resolve(import.meta.dirname, "e2e", "visual"),
  testIgnore: [],
  timeout: 180_000,
  retries: 0,
  snapshotPathTemplate: path.join(
    import.meta.dirname,
    ".data",
    "visual",
    "baseline",
    "{arg}{ext}",
  ),
  outputDir:
    process.env.STAAASH_VISUAL_OUT ??
    path.join(import.meta.dirname, ".data", "visual", "results"),
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
});
