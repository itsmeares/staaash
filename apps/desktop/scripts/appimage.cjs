const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdir, open, writeFile } = require("node:fs/promises");
const { createRequire } = require("node:module");
const { basename, join } = require("node:path");

const builderRequire = createRequire(require.resolve("electron-builder"));
const { appendBlockmap } = builderRequire(
  "app-builder-lib/out/targets/differentialUpdateInfoBuilder",
);
const nativeRebuildSettings = new WeakMap();

// The watcher ships Node-API prebuilts; rebuilding raises Linux's glibc requirement.
exports.beforePack = ({ electronPlatformName, packager }) => {
  const { config } = packager;
  if (!nativeRebuildSettings.has(config)) {
    nativeRebuildSettings.set(config, config.npmRebuild);
  }
  config.npmRebuild =
    electronPlatformName === "linux"
      ? false
      : nativeRebuildSettings.get(config);
};

exports.afterPack = async ({ appOutDir, targets }) => {
  const appImage = targets.find((target) => target.name === "appImage");
  if (!appImage) return;
  const applications = join(appOutDir, "usr/share/applications");
  await mkdir(applications, { recursive: true });
  await writeFile(
    join(applications, "staaash.desktop"),
    await appImage.desktopEntry.value,
  );
};

exports.artifactBuildCompleted = async (event) => {
  if (!event.file.endsWith(".AppImage")) return;
  const { file, updateInfo, packager } = event;
  const arch = basename(file).match(/-(x86_64|arm64)\.AppImage$/u)?.[1];
  assert(arch, "Unsupported AppImage architecture");
  const { owner, repo } = packager.config.publish;
  const channel = packager.appInfo.version.includes("-")
    ? "latest-all"
    : "latest";
  const information = `gh-releases-zsync|${owner}|${repo}|${channel}|Staaash-Desktop-*-${arch}.AppImage.zsync`;
  const section = execFileSync("objdump", ["-h", file], {
    encoding: "utf8",
  }).match(/\s\.upd_info\s+([\da-f]+)\s+\S+\s+\S+\s+([\da-f]+)/u);
  assert(section, "AppImage runtime has no update information section");
  const capacity = Number.parseInt(section[1], 16);
  const offset = Number.parseInt(section[2], 16);
  assert(
    Buffer.byteLength(information) < capacity,
    "AppImage update information is too long",
  );
  assert(
    Number.isSafeInteger(updateInfo?.blockMapSize) &&
      updateInfo.blockMapSize > 0,
    "AppImage block map is missing",
  );
  const payloadSize = updateInfo.size - updateInfo.blockMapSize - 4;
  assert(
    offset > 0 && offset + capacity <= payloadSize,
    "AppImage update section is outside the payload",
  );
  const image = await open(file, "r+");
  try {
    assert.equal(
      (await image.stat()).size,
      updateInfo.size,
      "AppImage size changed before finalization",
    );
    const trailer = Buffer.alloc(4);
    await image.read(trailer, 0, 4, updateInfo.size - 4);
    assert.equal(
      trailer.readUInt32BE(),
      updateInfo.blockMapSize,
      "AppImage block map size does not match",
    );
    const data = Buffer.alloc(capacity);
    await image.read(data, 0, capacity, offset);
    assert(
      data.every((byte) => byte === 0),
      "AppImage update information is already set",
    );
    data.write(information);
    await image.write(data, 0, capacity, offset);
    await image.truncate(payloadSize);
  } finally {
    await image.close();
  }
  // This hook finishes before artifactCreated generates the updater YAML.
  event.updateInfo = await appendBlockmap(file);
  execFileSync("zsyncmake", [
    "-u",
    basename(file),
    "-o",
    `${file}.zsync`,
    file,
  ]);
};
