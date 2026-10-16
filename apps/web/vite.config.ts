import path from "node:path";
import { defineConfig } from "vite-plus";

process.env.AUTH_SECRET ??= "test-placeholder-secret";
process.env.DATABASE_URL ??=
  "postgresql://staaash:staaash@localhost:5432/staaash";

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: "dependencies" }],
        cache: false,
      },
    },
  },
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Route tests import whole pages, and with files running in parallel on a
    // busy CPU the first import can pass the 5 s default.
    testTimeout: 15_000,
    include: ["server/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "server/**/*.postgres.test.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
