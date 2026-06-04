import path from "node:path";
import { defineConfig } from "vitest/config";

process.env.AUTH_SECRET ??= "test-placeholder-secret";
process.env.DATABASE_URL ??=
  "postgresql://staaash:staaash@localhost:5432/staaash";
process.env.UPLOAD_LOCATION = path.resolve(__dirname, ".tmp", "vitest-files");

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    include: ["server/**/*.test.ts"],
    // Storage-backed integration tests share an isolated fixture tree.
    // Run files serially to avoid cross-file races on Windows filesystem ops.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
