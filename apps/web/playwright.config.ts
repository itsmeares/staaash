import path from "node:path";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: process.env.CI ? [["dot"], ["json"]] : undefined,
  testDir: path.resolve(import.meta.dirname, "e2e"),
  outputDir: path.join(
    process.env.STAAASH_TEST_RESULTS ??
      path.resolve(import.meta.dirname, "test-results"),
    "e2e",
  ),
  testIgnore: ["visual/**"],
  timeout: 60_000,
  fullyParallel: false,
  workers: process.env.STAAASH_E2E_WORKERS
    ? Number(process.env.STAAASH_E2E_WORKERS)
    : undefined,
  retries: process.env.CI ? 2 : 0,
  failOnFlakyTests: Boolean(process.env.CI),
  use: {
    baseURL: process.env.STAAASH_E2E_BASE_URL,
    trace: "retain-on-failure",
  },
});
