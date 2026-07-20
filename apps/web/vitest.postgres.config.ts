import path from "node:path";
import { defineConfig } from "vitest/config";

const databaseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    "POSTGRES_TEST_DATABASE_URL is required for PostgreSQL integration tests.",
  );
}

process.env.DATABASE_URL = databaseUrl;
process.env.AUTH_SECRET ??= "postgres-test-placeholder-secret";
process.env.UPLOAD_LOCATION = path.resolve(
  __dirname,
  ".tmp",
  "vitest-postgres-files",
);

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.postgres.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
});
