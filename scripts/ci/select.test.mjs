import assert from "node:assert/strict";
import { test } from "node:test";

import { selectSuites } from "./select.mjs";

await test("ordinary UI changes run both native suites without upgrade drills", () => {
  assert.deepEqual(selectSuites(["apps/web/components/file-list/row.tsx"]), {
    app: true,
    upgrade: false,
    recovery: false,
  });
});

await test("documentation does not start application stacks", () => {
  assert.deepEqual(selectSuites(["docs/architecture.md", "README.md"]), {
    app: false,
    upgrade: false,
    recovery: false,
  });
});

await test("stored data and startup changes require upgrade and recovery", () => {
  for (const file of [
    "packages/db/prisma/migrations/new/migration.sql",
    "apps/web/server/files/service.ts",
    "apps/web/server/uploads/session-service.ts",
    "apps/worker/src/index.ts",
    "apps/web/instrumentation.ts",
    "Dockerfile",
    "scripts/ci/stack.mjs",
  ]) {
    assert.deepEqual(
      selectSuites([file]),
      {
        app: true,
        upgrade: true,
        recovery: true,
      },
      file,
    );
  }
});

await test("a lockfile alone does not turn a tooling update into an upgrade", () => {
  assert.equal(selectSuites(["pnpm-lock.yaml"]).upgrade, false);
  assert.equal(
    selectSuites(["pnpm-lock.yaml"], { runtimeChanged: true }).upgrade,
    true,
  );
});

await test("release and manual validation run everything, even on a version-only change", () => {
  assert.deepEqual(selectSuites(["package.json"], { full: true }), {
    app: true,
    upgrade: true,
    recovery: true,
  });
});
