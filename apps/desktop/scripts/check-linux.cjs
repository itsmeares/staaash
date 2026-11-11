const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { mkdtemp, rename, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join } = require("node:path");
const { test } = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");

test("packaged Electron watches file creation, rename, and deletion", async () => {
  assert(
    process.versions.electron,
    "Run this check with the packaged Electron binary",
  );
  const resources = join(dirname(process.execPath), "resources");
  assert(
    !existsSync(
      join(resources, "app.asar.unpacked/node_modules/@parcel/watcher/build"),
    ),
    "An unnecessary watcher source build was packaged",
  );
  const watcher = require(
    join(resources, "app.asar/node_modules/@parcel/watcher"),
  );
  const folder = await mkdtemp(join(tmpdir(), "staaash-watcher-"));
  const events = [];
  const subscription = await watcher.subscribe(folder, (error, batch) => {
    assert.ifError(error);
    events.push(...batch);
  });
  const waitFor = async (type, path) => {
    for (let i = 0; i < 100; i++) {
      if (events.some((event) => event.type === type && event.path === path))
        return;
      await delay(50);
    }
    assert.fail(`No ${type} event for ${path}`);
  };
  try {
    const original = join(folder, "original.txt");
    const renamed = join(folder, "renamed.txt");
    await writeFile(original, "Fake sync file");
    await waitFor("create", original);
    await rename(original, renamed);
    await waitFor("create", renamed);
    await waitFor("delete", original);
    await rm(renamed);
    await waitFor("delete", renamed);
  } finally {
    await subscription.unsubscribe();
    await rm(folder, { recursive: true });
  }
});
