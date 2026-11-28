import { readdirSync } from "node:fs";

import { sourceCoverage } from "../../test-coverage";
import { defineConfig } from "vite-plus";

// The worker waits for this migration before it starts (health.ts).
const latestMigration = readdirSync(
  new URL("prisma/migrations", import.meta.url),
  { withFileTypes: true },
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .at(-1);
if (!latestMigration) throw new Error("No migrations in prisma/migrations.");
const define = {
  __STAAASH_LATEST_MIGRATION__: JSON.stringify(latestMigration),
};

export default defineConfig({
  define,
  test: { coverage: sourceCoverage(["src/**/*.ts"]) },
  run: {
    tasks: {
      test: {
        command: "vp test run --passWithNoTests",
        dependsOn: [{ task: "build", from: "dependencies" }],
        cache: false,
      },
    },
  },
  pack: {
    entry: {
      client: "src/client.ts",
      jobs: "src/jobs.ts",
      health: "src/health.ts",
      instance: "src/instance.ts",
      admin: "src/admin.ts",
      reconciliation: "src/reconciliation.ts",
      "folder-tree": "src/folder-tree.ts",
      "media-derivatives": "src/media-derivatives.ts",
      "archive-selection": "src/archive-selection.ts",
      "zip-archives": "src/zip-archives.ts",
      "file-text": "src/file-text.ts",
      "upload-sessions": "src/upload-sessions.ts",
      "storage-transactions": "src/storage-transactions.ts",
      "storage-changes": "src/storage-changes.ts",
      "storage-mutations": "src/storage-mutations.ts",
      "storage-review": "src/storage-review.ts",
      "storage-mutation-executor": "src/storage-mutation-executor.ts",
    },
    format: ["esm"],
    platform: "node",
    define,
    outDir: "dist",
    dts: true,
    fixedExtension: false,
    clean: true,
    target: false,
  },
});
