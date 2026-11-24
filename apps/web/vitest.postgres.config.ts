import path from "node:path";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.postgres.test.ts"],
    globalSetup: ["./vitest.postgres.global.ts"],
    setupFiles: ["./vitest.postgres.setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    // GitHub's ARM64 runners stall now and then (issue #621).
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
