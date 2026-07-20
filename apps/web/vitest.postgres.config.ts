import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.postgres.test.ts"],
    globalSetup: ["./vitest.postgres.global.ts"],
    setupFiles: ["./vitest.postgres.setup.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
