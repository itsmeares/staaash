import path from "node:path";
import { defineConfig } from "vitest/config";

process.env.APP_URL ??= "http://localhost:3000";
process.env.AUTH_SECRET ??= "test-placeholder-secret";
process.env.DATABASE_URL ??=
  "postgresql://staaash:staaash@localhost:5432/staaash";
process.env.FILES_ROOT ??= "./.data/files";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts"],
    // Storage-backed integration tests share the same FILES_ROOT fixture tree.
    // Run files serially to avoid cross-file races on Windows filesystem ops.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
