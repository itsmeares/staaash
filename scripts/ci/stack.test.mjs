import assert from "node:assert/strict";
import { test } from "node:test";
import { suitesFor } from "./stack.mjs";

test("test paths run only the selected browser files", () => {
  assert.deepEqual(suitesFor([]), { browser: true, system: true });
  assert.deepEqual(suitesFor(["e2e/a.spec.ts"]), {
    browser: true,
    system: false,
  });
  assert.deepEqual(suitesFor([], "system"), {
    browser: false,
    system: true,
  });
  assert.throws(() => suitesFor(["e2e/a.spec.ts"], "system"));
  assert.throws(() => suitesFor(["e2e/a.spec.ts"], "all"));
  assert.throws(() => suitesFor([], "upgrade"));
});
