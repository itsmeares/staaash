import path from "node:path";

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: path.resolve(__dirname, "e2e"),
  outputDir: path.join(
    process.env.STAAASH_TEST_RESULTS ?? path.resolve(__dirname, "test-results"),
    "e2e",
  ),
  testIgnore: ["visual/**"],
  timeout: 60_000,
  fullyParallel: false,
  workers: process.env.STAAASH_E2E_WORKERS
    ? Number(process.env.STAAASH_E2E_WORKERS)
    : undefined,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: process.env.STAAASH_E2E_BASE_URL,
    trace: "retain-on-failure",
  },
});
