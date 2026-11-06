import { cpSync, copyFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { build, type Plugin } from "vite-plus";

const assetsDir = path.resolve(import.meta.dirname, "assets");
const sourcesFile = path.join(assetsDir, "demo", "SOURCES.md");

function assetSizes() {
  const sizes: Record<string, number> = {};
  for (const name of readdirSync(assetsDir, {
    recursive: true,
    encoding: "utf8",
  })) {
    const file = path.join(assetsDir, name);
    if (file !== sourcesFile && statSync(file).isFile())
      sizes[name.split(path.sep).join("/")] = statSync(file).size;
  }
  return sizes;
}

/**
 * Builds the public demo: the normal app, plus a service worker that answers
 * its API from sample data in the visitor's browser.
 */
export function demoBuild(): Plugin {
  // The public demo's address. Its path becomes the app's base path.
  const siteUrl =
    process.env.STAAASH_DEMO_URL ?? "https://itsmeares.github.io/staaash/";
  let outDir = "";
  let base = "/";
  return {
    name: "staaash-demo",
    apply: (_, { mode }) => mode === "demo",
    config(_, { command }) {
      if (command !== "build")
        throw new Error(
          "Demo mode is build-only. Use `pnpm ui` while developing.",
        );
      return {
        base: new URL(siteUrl).pathname,
        build: { outDir: "dist/demo" },
      };
    },
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      base = config.base;
    },
    transformIndexHtml: (html) =>
      html.replace(
        "<!--share-meta-->",
        [
          `<meta property="og:type" content="website" />`,
          `<meta property="og:title" content="Try Staaash" />`,
          `<meta property="og:description" content="A self-hosted cloud drive. This demo runs in your browser, so nothing you upload leaves your computer." />`,
          `<meta property="og:url" content="${siteUrl}" />`,
          `<meta property="og:image" content="${new URL("preview-card.jpg", siteUrl)}" />`,
          `<meta name="twitter:card" content="summary_large_image" />`,
        ].join("\n    "),
      ),
    async closeBundle() {
      cpSync(assetsDir, path.join(outDir, "samples"), {
        recursive: true,
        filter: (file) => file !== sourcesFile,
      });
      copyFileSync(
        path.join(import.meta.dirname, "preview-card.jpg"),
        path.join(outDir, "preview-card.jpg"),
      );
      // Pages serves 404.html for any unknown path, which lets deep links load
      // the app.
      copyFileSync(
        path.join(outDir, "index.html"),
        path.join(outDir, "404.html"),
      );
      await build({
        configFile: false,
        root: path.resolve(import.meta.dirname, "../.."),
        base,
        logLevel: "warn",
        resolve: {
          alias: { "@": path.resolve(import.meta.dirname, "../..") },
        },
        define: { __DEMO_ASSET_SIZES__: JSON.stringify(assetSizes()) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          // A classic script: module service workers are not in every browser.
          lib: {
            entry: path.join(import.meta.dirname, "service-worker.ts"),
            formats: ["iife"],
            name: "staaashDemo",
            fileName: () => "sw.js",
          },
        },
      });
    },
  };
}
