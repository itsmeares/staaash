import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

export const POSTGRES_TEST_DATABASE_PREFIX = "staaash_test_";
const POSTGRES_TEST_STORAGE_PREFIX = "staaash-postgres-test-";

type GlobalSetupProject = {
  provide(key: string, value: string): void;
};

const parsePostgresUrl = (value: string) => {
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("POSTGRES_TEST_DATABASE_URL must use PostgreSQL.");
  }
  return url;
};

const generatedDatabaseName = () =>
  `${POSTGRES_TEST_DATABASE_PREFIX}${randomUUID().replaceAll("-", "")}`;

const databaseIdentifier = (databaseName: string) => {
  if (
    !new RegExp(`^${POSTGRES_TEST_DATABASE_PREFIX}[a-f0-9]{32}$`).test(
      databaseName,
    )
  ) {
    throw new Error("Refusing non-generated PostgreSQL test database.");
  }
  return `"${databaseName}"`;
};

export const assertIsolatedPostgresTestTarget = ({
  databaseUrl,
  databaseName,
}: {
  databaseUrl: string;
  databaseName: string;
}) => {
  const url = parsePostgresUrl(databaseUrl);
  databaseIdentifier(databaseName);
  if (decodeURIComponent(url.pathname.slice(1)) !== databaseName) {
    throw new Error("PostgreSQL test URL is not bound to generated database.");
  }
};

const buildUrls = (baseUrl: string, databaseName: string) => {
  const controlUrl = parsePostgresUrl(baseUrl);
  controlUrl.searchParams.delete("schema");
  const isolatedUrl = new URL(controlUrl);
  isolatedUrl.pathname = `/${databaseName}`;
  assertIsolatedPostgresTestTarget({
    databaseUrl: isolatedUrl.toString(),
    databaseName,
  });
  return {
    controlUrl: controlUrl.toString(),
    isolatedUrl: isolatedUrl.toString(),
  };
};

const runMigrations = async (databaseUrl: string) => {
  const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const isWindows = process.platform === "win32";
  const executable = isWindows ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const args = isWindows
    ? ["/d", "/s", "/c", "pnpm --filter @staaash/db exec prisma migrate deploy"]
    : ["--filter", "@staaash/db", "exec", "prisma", "migrate", "deploy"];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workspaceRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `Prisma migration failed (${signal ?? `exit ${String(code)}`}).`,
          ),
        );
      }
    });
  });
};

const dropGeneratedDatabase = async ({
  controlUrl,
  isolatedUrl,
  databaseName,
}: {
  controlUrl: string;
  isolatedUrl: string;
  databaseName: string;
}) => {
  assertIsolatedPostgresTestTarget({ databaseUrl: isolatedUrl, databaseName });
  const client = new Client({ connectionString: controlUrl });
  await client.connect();
  try {
    await client.query(
      `DROP DATABASE ${databaseIdentifier(databaseName)} WITH (FORCE)`,
    );
  } finally {
    await client.end();
  }
};

const removeGeneratedStorage = async (storageRoot: string) => {
  const resolvedRoot = path.resolve(storageRoot);
  if (
    path.dirname(resolvedRoot) !== path.resolve(os.tmpdir()) ||
    !path.basename(resolvedRoot).startsWith(POSTGRES_TEST_STORAGE_PREFIX)
  ) {
    throw new Error("Refusing non-generated PostgreSQL test storage cleanup.");
  }
  await rm(resolvedRoot, { recursive: true, force: true });
};

export default async function setup(project: GlobalSetupProject) {
  const baseUrl = process.env.POSTGRES_TEST_DATABASE_URL?.trim();
  if (!baseUrl) {
    throw new Error(
      "POSTGRES_TEST_DATABASE_URL is required; DATABASE_URL is never used as fallback.",
    );
  }

  const databaseName = generatedDatabaseName();
  const { controlUrl, isolatedUrl } = buildUrls(baseUrl, databaseName);
  const storageRoot = await mkdtemp(
    path.join(os.tmpdir(), POSTGRES_TEST_STORAGE_PREFIX),
  );
  const client = new Client({ connectionString: controlUrl });
  let databaseCreated = false;

  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE ${databaseIdentifier(databaseName)} TEMPLATE template0`,
    );
    databaseCreated = true;
    await client.end();
    await runMigrations(isolatedUrl);
  } catch (error) {
    await client.end().catch(() => undefined);
    if (databaseCreated) {
      await dropGeneratedDatabase({
        controlUrl,
        isolatedUrl,
        databaseName,
      }).catch(() => undefined);
    }
    await removeGeneratedStorage(storageRoot).catch(() => undefined);
    throw error;
  }

  project.provide("postgresDatabaseUrl", isolatedUrl);
  project.provide("postgresDatabaseName", databaseName);
  project.provide("postgresStorageRoot", storageRoot);

  return async () => {
    let cleanupError: unknown;
    try {
      await dropGeneratedDatabase({ controlUrl, isolatedUrl, databaseName });
    } catch (error) {
      cleanupError = error;
    }
    try {
      await removeGeneratedStorage(storageRoot);
    } catch (error) {
      cleanupError ??= error;
    }
    if (cleanupError) throw cleanupError;
  };
}
