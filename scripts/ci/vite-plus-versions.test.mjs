import assert from "node:assert/strict";
import { test } from "node:test";

import { versionMismatches } from "./vite-plus-versions.mjs";

const bundled = { vitest: "5.1.1", vite: "npm:core@8.3.8001" };
const matching = {
  bundled,
  catalog: "5.1.1",
  coverage: "5.1.1",
  override: "npm:core@8.3.8001",
};

test("accepts versions that match what vite-plus bundles", () => {
  assert.deepEqual(versionMismatches(matching), []);
});

test("names each pin that differs from vite-plus", () => {
  const problems = versionMismatches({
    ...matching,
    coverage: "5.1.0",
    override: "npm:core@8.3.8000",
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /coverage-v8 in package.json is 5\.1\.0/);
  assert.match(problems[1], /vite override .* is npm:core@8\.3\.8000/);
});

test("reports a pin that is missing", () => {
  assert.equal(
    versionMismatches({ ...matching, catalog: undefined }).length,
    1,
  );
});
