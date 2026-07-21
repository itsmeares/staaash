import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    client: "src/client.ts",
    jobs: "src/jobs.ts",
    health: "src/health.ts",
    instance: "src/instance.ts",
    admin: "src/admin.ts",
    reconciliation: "src/reconciliation.ts",
    "viewer-contract": "src/viewer-contract.ts",
    "media-derivatives": "src/media-derivatives.ts",
    "zip-archives": "src/zip-archives.ts",
    "upload-sessions": "src/upload-sessions.ts",
  },
  format: ["esm"],
  platform: "node",
  outDir: "dist",
  dts: true,
  bundle: true,
});
