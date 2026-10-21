import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: path.resolve(__dirname, "system"),
  outputDir: path.join(
    process.env.STAAASH_TEST_RESULTS ?? path.resolve(__dirname, "test-results"),
    "system",
  ),
  timeout: 120_000,
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.STAAASH_E2E_BASE_URL,
    extraHTTPHeaders: {
      Origin: process.env.STAAASH_E2E_BASE_URL ?? "",
      Accept: "application/json",
    },
    trace: "retain-on-failure",
  },
});
