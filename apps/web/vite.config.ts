import { sourceCoverage } from "../../test-coverage";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const API_PORT = Number(process.env.STAAASH_API_PORT ?? 3001);
const UI_CACHE_DIR = path.resolve(
  __dirname,
  "node_modules/.vite-ui",
  process.env.STAAASH_UI_TEST_PORT ?? "dev",
);

// Share pages are app routes; everything else under /s/<token>/ is bytes from
// the server.
const SHARE_PAGE = /^\/s\/[^/]+(\/f\/[^/]+|\/files\/[^/]+)?\/?(\?.*)?$/;

function setDevelopmentDefaults() {
  process.env.AUTH_SECRET ??= "test-placeholder-secret";
  process.env.DATABASE_URL ??=
    "postgresql://staaash:staaash@localhost:5432/staaash";
}

export default defineConfig(async ({ command, mode }) => {
  const ui = mode === "ui";
  if (!ui) setDevelopmentDefaults();
  if (ui && command !== "serve")
    throw new Error(
      "UI preview mode is development-only. Use the normal build for releases.",
    );
  return {
    cacheDir: ui ? UI_CACHE_DIR : undefined,
    plugins: [
      ...(ui ? [(await import("./dev/ui/plugin")).uiPreview()] : []),
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
        routesDirectory: "src/routes",
        generatedRouteTree: "src/routeTree.gen.ts",
      }),
      react(),
      tailwindcss(),
    ],
    server: {
      port: 3000,
      proxy: {
        "/api": { target: `http://localhost:${API_PORT}` },
        "/auth/device-callback": { target: `http://localhost:${API_PORT}` },
        "/s/": {
          target: `http://localhost:${API_PORT}`,
          bypass: (request) =>
            request.method === "GET" && SHARE_PAGE.test(request.url ?? "")
              ? "/index.html"
              : undefined,
        },
      },
      ...(ui && { port: 3002, proxy: undefined }),
    },
    build: { outDir: "dist/client" },
    // The server bundles everything but pg and heic-convert, which load at
    // runtime with require. Installing @prisma/client would also pull in the
    // Prisma CLI and its tools as optional peers.
    pack: {
      entry: ["server/main.ts"],
      noExternal: (id) => !/^(pg|heic-convert)(\/|$)/.test(id),
      outDir: "dist/server",
      format: "esm",
      platform: "node",
      clean: true,
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
    test: {
      coverage: sourceCoverage(["server/**/*.ts"]),
      environment: "node",
      setupFiles: ["./vitest.setup.ts"],
      // Route tests import whole route groups, and with files running in
      // parallel on a busy CPU the first import can pass the 5 s default.
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
  };
});
