import { createServer } from "node:net";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const selectedPort = await new Promise<number>((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("Could not choose a preview port."));
      return;
    }
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});
const port = (process.env.STAAASH_UI_TEST_PORT ??= String(selectedPort));
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "ui-tests",
  outputDir: path.resolve("test-results/ui", port),
  workers: 1,
  timeout: 30_000,
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm ui --host 127.0.0.1 --port ${port} --strictPort`,
    url: `${baseURL}/__ui`,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/no_database",
      AUTH_SECRET: "",
      UPLOAD_LOCATION: "/path-that-must-not-be-used",
    },
  },
});
