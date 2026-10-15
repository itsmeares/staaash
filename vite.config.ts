import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*.{js,jsx,ts,tsx,mjs,cjs,json,md,yml,yaml,css}": "vp fmt",
  },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  fmt: {
    semi: true,
    singleQuote: false,
    printWidth: 80,
    sortPackageJson: false,
    sortTailwindcss: {
      stylesheet: "./apps/web/app/globals.css",
      functions: ["cn", "cva"],
      preserveWhitespace: true,
    },
    ignorePatterns: [
      "packages/db/src/generated/prisma/",
      "pnpm-lock.yaml",
      ".data/",
      ".next/",
      "coverage/",
      "dist/",
      ".fallow/",
    ],
  },
});
