import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const composeFile = fileURLToPath(new URL("./compose.yml", import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

export async function waitFor(check, label, timeout = 120_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      if (await check()) return;
    } catch {
      /* The dependency may still be starting. */
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

export async function createStack(image) {
  assert(
    image && !image.startsWith("-"),
    "An explicit test image is required.",
  );
  const root = await mkdtemp(
    path.join(process.env.STAAASH_TEST_ROOT ?? os.tmpdir(), "staaash-test-"),
  );
  const id = randomUUID().replaceAll("-", "");
  const state = {
    root,
    project: `staaash-test-${id.slice(0, 12)}`,
    image,
    database: `staaash_test_${id}`,
    files: path.join(root, "files"),
    stateFile: path.join(root, "state.json"),
    origin: "",
    databaseUrl: "",
    webPort: await freePort(),
    databasePort: await freePort(),
  };
  await mkdir(state.files);
  await writeFile(path.join(state.root, ".staaash-test-root"), state.project);
  return state;
}

export function compose(state, args, options = {}) {
  assert.match(state.project, /^staaash-test-[a-f0-9]{12}$/);
  assert.match(state.database, /^staaash_test_[a-f0-9]{32}$/);
  return execFileSync(
    "docker",
    ["compose", "-p", state.project, "-f", composeFile, ...args],
    {
      cwd: repo,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: {
        ...process.env,
        STAAASH_TEST_IMAGE: state.image,
        STAAASH_TEST_DATABASE: state.database,
        STAAASH_TEST_FILES: state.files,
        STAAASH_TEST_DATABASE_PORT: String(state.databasePort),
        STAAASH_TEST_WEB_PORT: String(state.webPort),
      },
      ...options,
    },
  );
}

export async function startDatabase(state) {
  compose(state, ["up", "-d", "db"]);
  await waitFor(() => {
    compose(
      state,
      ["exec", "-T", "db", "pg_isready", "-U", "test", "-d", state.database],
      { stdio: "pipe" },
    );
    return true;
  }, "isolated PostgreSQL");
  const address = compose(state, ["port", "db", "5432"]).trim();
  state.databaseUrl = `postgresql://test:test-only-password@${address}/${state.database}`;
  await writeFile(state.stateFile, JSON.stringify(state));
}

export function testEnv(state) {
  return {
    ...process.env,
    DATABASE_URL: state.databaseUrl,
    AUTH_SECRET: "test-only-secret-for-isolated-stacks",
    FILES_ROOT: state.files,
    UPLOAD_LOCATION: state.files,
    STAAASH_E2E_PROJECT: state.project,
    STAAASH_E2E_STATE_FILE: path.join(state.root, "accounts.json"),
    STAAASH_TEST_STATE: state.stateFile,
    STAAASH_TEST_RESULTS: path.join(repo, ".data", "ci", state.project),
    STAAASH_E2E_BASE_URL: state.origin,
    STAAASH_E2E_WORKERS: process.env.STAAASH_E2E_WORKERS ?? "2",
  };
}

export async function startApp(state, migrate = true, configured = true) {
  if (migrate)
    compose(state, [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "web",
      "prisma",
      "migrate",
      "deploy",
    ]);
  compose(state, ["up", "-d", "web", ...(configured ? ["worker"] : [])]);
  state.origin = `http://${compose(state, ["port", "web", "2113"]).trim()}`;
  await writeFile(state.stateFile, JSON.stringify(state));
  await waitFor(
    async () =>
      (await fetch(`${state.origin}${configured ? "/api/health/ready" : "/"}`))
        .ok,
    "application readiness",
  );
}

export async function destroyStack(state) {
  assert.equal(
    await readFile(path.join(state.root, ".staaash-test-root"), "utf8"),
    state.project,
  );
  const errors = [];
  for (const cleanup of [
    () => compose(state, ["stop", "web", "worker"]),
    () =>
      compose(state, [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "chown",
        "web",
        "-R",
        `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "/data/files",
      ]),
    () => compose(state, ["down", "--volumes", "--remove-orphans"]),
    () => rm(state.root, { recursive: true, force: true }),
  ]) {
    try {
      await cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, `Cleanup failed for ${state.project}.`);
}

const run = (args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, { cwd: repo, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Test command exited ${code}.`)),
    );
  });

const runSystem = (state, file, extraEnv = {}) =>
  run(
    [
      "--filter",
      "web",
      "exec",
      "playwright",
      "test",
      "-c",
      "playwright.system.config.ts",
      file,
    ],
    { ...testEnv(state), ...extraEnv },
  );

const migrationHistory = (state) =>
  compose(state, [
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "test",
    "-d",
    state.database,
    "-Atc",
    'SELECT json_agg(m ORDER BY migration_name) FROM "_prisma_migrations" m',
  ]);

async function validateUpgrade(state, candidate) {
  await runSystem(state, "upgrade.spec.mjs", { STAAASH_TEST_PHASE: "seed" });
  compose(state, ["stop", "web", "worker"]);
  state.image = candidate;
  await startApp(state);
  const history = migrationHistory(state);
  compose(state, ["stop", "web", "worker"]);
  await startApp(state);
  assert.equal(migrationHistory(state), history);
  await runSystem(state, "upgrade.spec.mjs", { STAAASH_TEST_PHASE: "verify" });
}

async function validateCurrent(state) {
  if (process.env.STAAASH_TEST_VISUAL === "true") {
    await run(
      [
        "--filter",
        "web",
        "e2e:visual",
        ...(process.env.STAAASH_TEST_UPDATE_SNAPSHOTS === "true"
          ? ["--update-snapshots"]
          : []),
      ],
      testEnv(state),
    );
  }
  await run(
    ["--filter", "web", "e2e", ...process.argv.slice(2)],
    testEnv(state),
  );
  await runSystem(state, "app.spec.mjs");
  if (process.env.STAAASH_TEST_RECOVERY === "true")
    await runSystem(state, "recovery.spec.mjs");
}

async function validateInstallation(state, upgrade) {
  const candidate = state.image;
  await startDatabase(state);
  if (upgrade) {
    assert(
      process.env.STAAASH_UPGRADE_IMAGE,
      "Resolve an immutable stable image before upgrade validation.",
    );
    state.image = process.env.STAAASH_UPGRADE_IMAGE;
  }
  compose(state, [
    "run",
    "--rm",
    "--no-deps",
    "-T",
    "web",
    "prisma",
    "migrate",
    "deploy",
  ]);
  await run(["--filter", "web", "e2e:prepare"], testEnv(state));
  await startApp(state, false);
  if (upgrade) await validateUpgrade(state, candidate);
  else await validateCurrent(state);
}

async function main() {
  const results = path.join(repo, ".data", "ci");
  await mkdir(results, { recursive: true });
  const state = await createStack(process.env.STAAASH_TEST_IMAGE);
  const started = Date.now();
  const upgrade = process.env.STAAASH_TEST_UPGRADE === "true";
  const errors = [];
  try {
    await validateInstallation(state, upgrade);
  } catch (error) {
    errors.push(error);
  }
  try {
    await writeFile(
      path.join(results, `${upgrade ? "upgrade" : "app"}.log`),
      compose(state, ["logs", "--no-color"]),
    );
  } catch (error) {
    errors.push(error);
  }
  try {
    await destroyStack(state);
  } catch (error) {
    errors.push(error);
  }
  console.log(
    `Isolated stack completed in ${Math.round((Date.now() - started) / 1000)} seconds.`,
  );
  if (errors.length)
    throw new AggregateError(errors, `Validation failed for ${state.project}.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
