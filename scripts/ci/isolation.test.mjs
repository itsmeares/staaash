import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

await test("E2E preparation rejects unowned targets before opening a database connection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staaash-isolation-"));
  const id = randomUUID().replaceAll("-", "");
  const project = `staaash-test-${id.slice(0, 12)}`;
  await mkdir(path.join(root, "files"));
  await writeFile(path.join(root, ".staaash-test-root"), project);
  let connections = 0;
  const witness = net.createServer((socket) => {
    connections++;
    socket.destroy();
  });
  await new Promise((resolve) => witness.listen(0, "127.0.0.1", resolve));
  const databaseUrl = `postgresql://test:test@127.0.0.1:${witness.address().port}/staaash_test_${id}`;
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    AUTH_SECRET: "test-only-secret",
    FILES_ROOT: path.join(root, "files"),
    STAAASH_E2E_STATE_FILE: path.join(root, "accounts.json"),
    STAAASH_E2E_PROJECT: project,
  };
  const prepare = (overrides = {}) =>
    promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../apps/web/scripts/e2e-bootstrap.mjs", import.meta.url),
        ),
      ],
      { env: { ...env, ...overrides }, timeout: 5000 },
    );
  try {
    for (const overrides of [
      { DATABASE_URL: databaseUrl.replace(`staaash_test_${id}`, "staaash") },
      { STAAASH_E2E_PROJECT: "staaash" },
      { STAAASH_E2E_STATE_FILE: path.join(root, "elsewhere", "accounts.json") },
    ]) {
      await assert.rejects(prepare(overrides), (error) =>
        /ERR_ASSERTION/.test(error.stderr ?? ""),
      );
      assert.equal(connections, 0);
    }
    await assert.rejects(prepare(), (error) =>
      /Connection terminated unexpectedly/.test(error.stderr ?? ""),
    );
    assert(connections > 0);
  } finally {
    await new Promise((resolve) => witness.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
