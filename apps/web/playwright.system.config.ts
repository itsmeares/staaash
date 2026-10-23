import path from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: process.env.CI ? [["dot"], ["json"]] : undefined,
  testDir: path.resolve(import.meta.dirname, "system"),
  outputDir: path.join(
    process.env.STAAASH_TEST_RESULTS ?? path.resolve(import.meta.dirname, "test-results"),
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
