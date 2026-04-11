import path from "node:path";

import { defineConfig } from "@playwright/test";

const port = Number(process.env.STAAASH_E2E_PORT ?? 3100);
const baseURL = process.env.STAAASH_E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: path.resolve(__dirname, "e2e"),
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: process.env.STAAASH_E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm e2e:prepare && pnpm dev --hostname 127.0.0.1 --port ${port}`,
        cwd: __dirname,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
