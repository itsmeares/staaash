import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

await test("CI detects locked runtime updates without treating tooling peer changes as upgrades", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "staaash-ci-selection-"));
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const commit = () =>
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@staaash.test",
      "commit",
      "-qm",
      "test fixture",
    );
  try {
    git("init", "-q", "-b", "main");
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "packages:\n  'next@16.0.0(typescript@5.0.0)': {}\n",
    );
    git("add", "package.json", "pnpm-lock.yaml");
    commit();
    const base = git("rev-parse", "HEAD");
    const select = () =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL("./select.mjs", import.meta.url))],
          {
            cwd: root,
            env: {
              ...process.env,
              CI_BASE_SHA: base,
              CI_FULL: "false",
              GITHUB_OUTPUT: "",
            },
            encoding: "utf8",
          },
        ),
      );
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "packages:\n  'next@16.0.0(typescript@6.0.0)': {}\n",
    );
    git("add", "pnpm-lock.yaml");
    commit();
    assert.equal(select().upgrade, false);
    await writeFile(
      path.join(root, "pnpm-lock.yaml"),
      "packages:\n  'next@16.1.0(typescript@6.0.0)': {}\n",
    );
    git("add", "pnpm-lock.yaml");
    commit();
    assert.equal(select().upgrade, true);
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: "2.0.0" }),
    );
    git("add", "package.json");
    commit();
    assert.deepEqual(select(), {
      app: true,
      upgrade: true,
      recovery: true,
      desktop: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
