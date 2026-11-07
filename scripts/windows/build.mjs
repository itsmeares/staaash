// Builds Staaash-Server-<version>-win-x64.exe from a built checkout:
// pnpm install, pnpm db:generate, and pnpm build must have run first.
// Needs makensis and, off Windows, unzip.
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..", "..");
const here = import.meta.dirname;
const work = path.join(repo, ".data", "windows-build");
const cache = path.join(work, "cache");
const payload = path.join(work, "payload");
const output = path.join(work, "out");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const version = readJson(
  path.join(repo, "apps", "web", "package.json"),
).version;
const components = readJson(path.join(here, "components.json"));

// pnpm and npm are .cmd shims on Windows and need cmd.exe, which splits
// unquoted arguments at spaces.
const shims = new Set(["pnpm", "npm"]);
const run = (command, args, options = {}) =>
  process.platform === "win32" && shims.has(command)
    ? execSync([command, ...args.map((arg) => `"${arg}"`)].join(" "), {
        stdio: "inherit",
        ...options,
      })
    : execFileSync(command, args, { stdio: "inherit", ...options });

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const download = async (name) => {
  const { url, sha256: expected } = components[name];
  const file = path.join(cache, path.basename(new URL(url).pathname));
  if (!existsSync(file) || sha256(file) !== expected) {
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
    writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const actual = sha256(file);
  if (actual !== expected) {
    throw new Error(`${url} has checksum ${actual}, expected ${expected}.`);
  }
  return file;
};

const unzip = (archive, target) => {
  mkdirSync(target, { recursive: true });
  // Windows 10 and newer ship bsdtar, which reads zip files.
  if (process.platform === "win32") run("tar", ["-xf", archive, "-C", target]);
  else run("unzip", ["-q", archive, "-d", target]);
};

/** Extracts an archive whose files sit in one top folder. */
const unzipFlat = (archive, target) => {
  const scratch = `${target}.extract`;
  rmSync(scratch, { recursive: true, force: true });
  unzip(archive, scratch);
  const [top] = readdirSync(scratch);
  renameSync(path.join(scratch, top), target);
  rmSync(scratch, { recursive: true });
};

// A PNG inside an ICO container; Windows reads it for 256 px icons.
const writeIcon = (png, target) => {
  const image = readFileSync(png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6);
  header.writeUInt8(0, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(image.length, 14);
  header.writeUInt32LE(22, 18);
  writeFileSync(target, Buffer.concat([header, image]));
};

const deploy = (pkg, target) =>
  run(
    "pnpm",
    [
      "--filter",
      pkg,
      "deploy",
      "--prod",
      "--legacy",
      // Flat node_modules keeps paths short enough for Program Files.
      "--config.node-linker=hoisted",
      target,
    ],
    { cwd: repo },
  );

rmSync(payload, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });

const app = path.join(payload, "app");
deploy("web", path.join(app, "web"));
deploy("worker", path.join(app, "worker"));
cpSync(
  path.join(repo, "apps", "worker", "dist"),
  path.join(app, "worker", "dist"),
  { recursive: true },
);
cpSync(path.join(here, "start-web.mjs"), path.join(app, "start-web.mjs"));

// Migrations run with the Prisma CLI the repository was tested with.
const migrate = path.join(app, "migrate");
const prismaVersion = readJson(
  path.join(repo, "packages", "db", "node_modules", "prisma", "package.json"),
).version;
mkdirSync(migrate, { recursive: true });
writeFileSync(
  path.join(migrate, "package.json"),
  `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
);
run(
  "npm",
  [
    "install",
    `prisma@${prismaVersion}`,
    "--no-fund",
    "--no-audit",
    "--no-package-lock",
  ],
  // Fetch the Windows migration engine even when building on Linux.
  {
    cwd: migrate,
    env: { ...process.env, PRISMA_CLI_BINARY_TARGETS: "windows" },
  },
);
cpSync(
  path.join(repo, "packages", "db", "prisma"),
  path.join(migrate, "prisma"),
  { recursive: true },
);
cpSync(
  path.join(repo, "packages", "db", "prisma.config.ts"),
  path.join(migrate, "prisma.config.ts"),
);

const setup = path.join(payload, "setup");
mkdirSync(setup);
cpSync(path.join(here, "setup.mjs"), path.join(setup, "setup.mjs"));
cpSync(
  path.join(repo, "packages", "config", "dist", "version.js"),
  path.join(setup, "version.mjs"),
);
cpSync(path.join(repo, "LICENSE"), path.join(payload, "LICENSE.txt"));

unzipFlat(await download("node"), path.join(payload, "node"));

// The server binaries only: no pgAdmin, StackBuilder, docs, or headers.
const pgScratch = path.join(work, "pgsql");
rmSync(pgScratch, { recursive: true, force: true });
unzip(await download("postgres"), pgScratch);
for (const part of [
  "bin",
  "lib",
  "share",
  "server_license.txt",
  "commandlinetools_3rd_party_licenses.txt",
]) {
  cpSync(
    path.join(pgScratch, "pgsql", part),
    path.join(payload, "pgsql", part),
    {
      recursive: true,
    },
  );
}
rmSync(pgScratch, { recursive: true });

const ffmpegScratch = path.join(work, "ffmpeg");
rmSync(ffmpegScratch, { recursive: true, force: true });
unzipFlat(await download("ffmpeg"), ffmpegScratch);
for (const part of ["bin/ffmpeg.exe", "bin/ffprobe.exe", "LICENSE"]) {
  cpSync(path.join(ffmpegScratch, part), path.join(payload, "ffmpeg", part));
}
rmSync(ffmpegScratch, { recursive: true });

// PostgreSQL needs the Visual C++ runtime, which a fresh Windows Server lacks.
mkdirSync(path.join(payload, "redist"));
cpSync(
  await download("vcredist"),
  path.join(payload, "redist", "vc_redist.x64.exe"),
);

const winsw = await download("winsw");
mkdirSync(path.join(payload, "services"));
for (const id of ["StaaashWeb", "StaaashWorker"]) {
  cpSync(winsw, path.join(payload, "services", `${id}.exe`));
}

const icon = path.join(work, "staaash.ico");
writeIcon(path.join(repo, "design", "App", "Staaash App Icon@0.25.png"), icon);

const outFile = path.join(output, `Staaash-Server-${version}-win-x64.exe`);
run("makensis", [
  "-V2",
  `-DVERSION=${version}`,
  `-DVERSION_NUMBER=${version.split("-")[0]}`,
  `-DPAYLOAD=${payload}`,
  `-DICON=${icon}`,
  `-DOUTFILE=${outFile}`,
  path.join(here, "staaash-server.nsi"),
]);
console.log(`Built ${outFile}`);
