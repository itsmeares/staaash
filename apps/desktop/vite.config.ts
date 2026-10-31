import { sourceCoverage } from "../../test-coverage";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  // The windows: one page, the view picked by the URL hash.
  root: "src/renderer",
  base: "./",
  plugins: [react(), tailwindcss()],
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
  // The main process, the preload script and the sync engine. Electron loads
  // CommonJS preloads in sandboxed windows, so everything is CommonJS.
  pack: {
    entry: {
      "main/index": "src/main/index.ts",
      "preload/index": "src/preload/index.ts",
      "engine/index": "src/engine/index.ts",
    },
    outDir: "dist",
    format: "cjs",
    platform: "node",
    // Everything is bundled except Electron itself and the native watcher,
    // the one production dependency, which loads at run time.
    deps: { neverBundle: ["electron"], onlyBundle: false },
    clean: false,
  },
  run: {
    tasks: {
      test: {
        command: "vp test run",
        dependsOn: [{ task: "build", from: "dependencies" }],
        cache: false,
      },
    },
  },
  // Shared helpers and the server's route types come from the web app.
  resolve: { alias: { "@": path.resolve(__dirname, "../web") } },
  test: {
    root: ".",
    coverage: sourceCoverage(["src/engine/**/*.ts"]),
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
