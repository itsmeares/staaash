const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  appendFile,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} = require("node:fs/promises");
const { createRequire } = require("node:module");
const { tmpdir } = require("node:os");
const { basename, join } = require("node:path");
const { afterEach, test } = require("node:test");
const { inflateRawSync } = require("node:zlib");
const { artifactBuildCompleted, beforePack } = require("./appimage.cjs");

const builderRequire = createRequire(require.resolve("electron-builder"));
const { appendBlockmap } = builderRequire(
  "app-builder-lib/out/targets/differentialUpdateInfoBuilder",
);
const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => rm(dir, { recursive: true })),
  );
});

const fixture = async (version = "2.0.0", arch = "x86_64", capacity = 1024) => {
  const dir = await mkdtemp(join(tmpdir(), "staaash-appimage-"));
  directories.push(dir);
  const section = join(dir, "information");
  const file = join(dir, `Staaash-Desktop-${version}-${arch}.AppImage`);
  await writeFile(section, Buffer.alloc(capacity));
  execFileSync("objcopy", [
    "--add-section",
    `.upd_info=${section}`,
    "/bin/true",
    file,
  ]);
  await appendFile(file, Buffer.alloc(40_000, 90));
  return {
    file,
    updateInfo: await appendBlockmap(file),
    packager: {
      appInfo: { version },
      config: { publish: { owner: "itsmeares", repo: "staaash" } },
    },
  };
};

for (const [version, arch, channel] of [
  ["2.0.0", "x86_64", "latest"],
  ["2.0.0-rc.8", "arm64", "latest-all"],
]) {
  test(`finalizes ${version} ${arch} for both update tools`, async () => {
    const event = await fixture(version, arch);
    const before = await readFile(event.file);
    const payloadSize = before.length - event.updateInfo.blockMapSize - 4;
    await artifactBuildCompleted(event);
    const image = await readFile(event.file);
    assert(
      image.includes(
        Buffer.from(
          `gh-releases-zsync|itsmeares|staaash|${channel}|Staaash-Desktop-*-${arch}.AppImage.zsync`,
        ),
      ),
    );
    assert.equal(image.length, event.updateInfo.size);
    assert.equal(
      createHash("sha512").update(image).digest("base64"),
      event.updateInfo.sha512,
    );
    const blockMapSize = image.readUInt32BE(image.length - 4);
    assert.equal(blockMapSize, event.updateInfo.blockMapSize);
    const map = JSON.parse(
      inflateRawSync(image.subarray(-4 - blockMapSize, -4)),
    );
    assert.equal(
      map.files[0].sizes.reduce((sum, size) => sum + size, 0),
      payloadSize,
    );
    assert.deepEqual(
      image.subarray(payloadSize - 40_000, payloadSize),
      before.subarray(payloadSize - 40_000, payloadSize),
    );
    const companion = await readFile(`${event.file}.zsync`);
    assert(companion.includes(Buffer.from(`URL: ${basename(event.file)}\n`)));
    assert(
      companion.includes(
        Buffer.from(
          `SHA-1: ${createHash("sha1").update(image).digest("hex")}\n`,
        ),
      ),
    );
    const restored = join(directories[0], "restored.AppImage");
    execFileSync(
      "zsync",
      ["-i", event.file, "-o", "restored.AppImage", `${event.file}.zsync`],
      { cwd: directories[0] },
    );
    assert.deepEqual(await readFile(restored), image);
  });
}

for (const problem of [
  "small section",
  "missing section",
  "missing block map",
  "wrong block map",
  "existing information",
]) {
  test(`rejects ${problem} without changing the package`, async () => {
    const event = await fixture(
      "2.0.0",
      "x86_64",
      problem === "small section" ? 8 : 1024,
    );
    if (problem === "missing section") {
      execFileSync("objcopy", ["--remove-section", ".upd_info", event.file]);
      event.updateInfo = await appendBlockmap(event.file);
    }
    if (problem === "missing block map") event.updateInfo = undefined;
    if (problem === "wrong block map") event.updateInfo.blockMapSize++;
    if (problem === "existing information") {
      const section = join(directories[0], "information");
      await writeFile(section, Buffer.alloc(1024, 1));
      execFileSync("objcopy", [
        "--update-section",
        `.upd_info=${section}`,
        event.file,
      ]);
      event.updateInfo = await appendBlockmap(event.file);
    }
    const before = await readFile(event.file);
    await assert.rejects(artifactBuildCompleted(event), /AppImage/u);
    assert.deepEqual(await readFile(event.file), before);
  });
}

test("leaves other installers alone", async () => {
  await artifactBuildCompleted({ file: "Staaash.exe" });
});

for (const npmRebuild of [undefined, true, false]) {
  test(`preserves npmRebuild=${npmRebuild} across Linux and later platforms`, () => {
    const packager = { config: { npmRebuild } };
    for (const electronPlatformName of ["linux", "linux", "win32", "darwin"]) {
      beforePack({ electronPlatformName, packager });
      assert.equal(
        packager.config.npmRebuild,
        electronPlatformName === "linux" ? false : npmRebuild,
      );
    }
  });
}
