import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { assembleDemo, pickDemoBuilds } from "./demo-pages.mjs";

const release = (tag_name, changes = {}) => ({
  tag_name,
  draft: false,
  prerelease: tag_name.includes("-"),
  ...changes,
});

await test("the main demo follows the newest stable release, not an RC", () => {
  const builds = pickDemoBuilds([
    release("v2.1.0-rc.1"),
    release("v2.0.0"),
    release("v2.0.0-rc.10"),
    release("v1.2.0"),
  ]);
  assert.deepEqual(builds, [
    {
      name: "stable",
      ref: "v2.0.0",
      url: "https://demo.staaash.org/",
      candidate: "2.1.0-rc.1",
      stable: "",
    },
    {
      name: "candidate",
      ref: "v2.1.0-rc.1",
      url: "https://demo.staaash.org/rc/",
      candidate: "",
      stable: "2.0.0",
    },
  ]);
});

await test("the newest of several RCs gets the RC demo", () => {
  const builds = pickDemoBuilds([
    release("v2.1.0-rc.2"),
    release("v2.1.0-rc.10"),
    release("v2.0.0"),
  ]);
  assert.equal(builds[1].ref, "v2.1.0-rc.10");
});

await test("RCs older than the stable release and drafts get no demo", () => {
  const builds = pickDemoBuilds([
    release("v2.1.0"),
    release("v2.1.0-rc.1"),
    release("v2.2.0-rc.1", { draft: true }),
    release("v2.2.0", { draft: true }),
  ]);
  assert.deepEqual(
    builds.map((build) => [build.name, build.ref, build.candidate]),
    [["stable", "v2.1.0", ""]],
  );
});

await test("there is no demo without a stable release", () => {
  assert.throws(() => pickDemoBuilds([release("v2.1.0-rc.1")]));
});

const demoDir = (root, name, html) => {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), html);
  writeFileSync(path.join(dir, "404.html"), html);
  return dir;
};

await test("the RC demo goes under /rc/ and the root 404 page forwards to it", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "demo-pages-"));
  try {
    const out = path.join(root, "site");
    assembleDemo(
      out,
      demoDir(root, "stable", "<html><head></head><body>stable</body></html>"),
      demoDir(root, "candidate", "<html><head></head><body>rc</body></html>"),
    );
    assert.match(readFileSync(path.join(out, "index.html"), "utf8"), /stable/);
    assert.match(readFileSync(path.join(out, "rc/index.html"), "utf8"), /rc/);
    const notFound = readFileSync(path.join(out, "404.html"), "utf8");
    assert.match(notFound, /location\.replace\("\/rc\/"\+"\?demo-path="/);
    assert.doesNotMatch(
      readFileSync(path.join(root, "stable/404.html"), "utf8"),
      /demo-path/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

await test("without an RC, /rc/ stops the old RC demo and opens the main one", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "demo-pages-"));
  try {
    const out = path.join(root, "site");
    assembleDemo(
      out,
      demoDir(root, "stable", "<html><head></head><body>stable</body></html>"),
    );
    const page = readFileSync(path.join(out, "rc/index.html"), "utf8");
    assert.match(page, /unregister\(\)/);
    assert.match(page, /location\.replace\("\/"\)/);
    assert.match(readFileSync(path.join(out, "404.html"), "utf8"), /demo-path/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
