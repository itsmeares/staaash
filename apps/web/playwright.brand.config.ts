import { defineConfig } from "@playwright/test";
import uiConfig from "./playwright.ui.config";

/** Retakes the brand kit screenshots and banners from the frontend preview. */
export default defineConfig(uiConfig, {
  testDir: "brand",
  timeout: 300_000,
  // The full browser, because headless shell has no PDF viewer.
  use: { ...uiConfig.use, channel: "chromium" },
});
