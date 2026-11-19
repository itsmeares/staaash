import { defineConfig } from "@playwright/test";
import uiConfig, { freePort } from "./playwright.ui.config";

// The system can hand back the port the web preview just took, so ask again.
let desktopPort = process.env.STAAASH_DESKTOP_UI_PORT;
while (!desktopPort || desktopPort === process.env.STAAASH_UI_TEST_PORT)
  desktopPort = String(await freePort());
process.env.STAAASH_DESKTOP_UI_PORT = desktopPort;

/** Retakes the brand kit screenshots and banners from the frontend preview. */
export default defineConfig(uiConfig, {
  testDir: "brand",
  timeout: 300_000,
  // The full browser, because headless shell has no PDF viewer.
  use: {
    ...uiConfig.use,
    channel: "chromium",
    launchOptions: {
      args: [
        // The sync card frames the desktop window from its own local port,
        // which Chromium's local network checks block.
        "--disable-features=LocalNetworkAccessChecks",
        // The PDF viewer runs in its own process, which ignores the emulated
        // scale and draws a 2x page into half of its box.
        "--force-device-scale-factor=2",
      ],
    },
  },
  // Added to the frontend preview's server: the desktop app's window, which
  // brand/desktop.ts fills with demo data.
  webServer: [
    {
      command: `vp dev --host 127.0.0.1 --port ${desktopPort} --strictPort`,
      cwd: "../desktop",
      url: `http://127.0.0.1:${desktopPort}/`,
      reuseExistingServer: false,
    },
  ],
});
