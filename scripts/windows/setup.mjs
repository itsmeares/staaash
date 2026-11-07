// Sets up, updates, and removes a Windows server install. The installer runs
// it with the bundled Node.js; it never deletes the data folder.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";

import { compareSemanticVersions } from "./version.mjs";

export const POSTGRES_MAJOR = "18";
const POSTGRES_SERVICE = "StaaashPostgres";
const FIREWALL_RULE = "Staaash Server";
const HEALTH_TIMEOUT_MS = 120_000;

// Well-known SIDs work in every Windows language.
const SID = {
  system: "*S-1-5-18",
  networkService: "*S-1-5-20",
  administrators: "*S-1-5-32-544",
};

export const ACCOUNTS = {
  NetworkService: { domain: "NT AUTHORITY", user: "NetworkService" },
  LocalSystem: null,
};

/** Exit codes the installer turns into messages. */
export const EXIT = {
  ok: 0,
  failed: 1,
  unhealthy: 2,
  downgrade: 3,
  postgres: 4,
};

class SetupError extends Error {
  constructor(message, exitCode = EXIT.failed) {
    super(message);
    this.exitCode = exitCode;
  }
}

const dataPaths = (dataDir) => ({
  files: path.join(dataDir, "files"),
  postgres: path.join(dataDir, "postgres"),
  logs: path.join(dataDir, "logs"),
  env: path.join(dataDir, "staaash.env"),
});

const isInside = (child, parent) => {
  const relative = path.relative(parent.toLowerCase(), child.toLowerCase());
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

/**
 * Refuses an older version, a data folder inside the program folder (updates
 * replace it), and a database from another PostgreSQL major.
 */
export const precheck = ({ installed, version, appDir, dataDir }) => {
  // The data folder's permissions are locked down, which must not hit a drive.
  if (path.parse(path.resolve(dataDir)).root === path.resolve(dataDir)) {
    throw new SetupError("Pick a folder for the data, not a whole drive.");
  }
  // The settings file can quote a value holding one of these, not both.
  if (dataDir.includes("'") && dataDir.includes("`")) {
    throw new SetupError(
      "Pick a data folder without both ' and ` in its path.",
    );
  }
  if (isInside(dataDir, appDir)) {
    throw new SetupError(
      "Pick a data folder outside the Staaash Server program folder.",
    );
  }
  if (installed && compareSemanticVersions(version, installed) < 0) {
    throw new SetupError(
      `Staaash ${installed} is installed, which is newer than ${version}. ` +
        "To go back, restore the backup you made before updating.",
      EXIT.downgrade,
    );
  }
  const versionFile = path.join(dataPaths(dataDir).postgres, "PG_VERSION");
  if (!existsSync(versionFile)) return;
  const major = readFileSync(versionFile, "utf8").trim();
  if (major !== POSTGRES_MAJOR) {
    throw new SetupError(
      `The database in ${dataDir} was made by PostgreSQL ${major}, and this ` +
        `installer runs PostgreSQL ${POSTGRES_MAJOR}. It was left untouched.`,
      EXIT.postgres,
    );
  }
};

// The services read this file with node --env-file, so parse it the same way.
export const parseEnvFile = (text) => ({ ...parseEnv(text) });

// Quoted so `#` stays part of the value; single quotes keep backslashes as is.
const quoteEnvValue = (value) => {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes("`")) return `\`${value}\``;
  throw new SetupError(`A setting cannot hold both ' and \`: ${value}`);
};

export const renderEnvFile = (values) =>
  [
    "# Staaash server settings. Restart the Staaash services after a change.",
    ...Object.entries(values).map(
      ([key, value]) => `${key}=${quoteEnvValue(String(value))}`,
    ),
    "",
  ].join("\r\n");

const escapeXml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** WinSW configuration for the web or worker service. */
export const renderServiceXml = ({
  id,
  name,
  description,
  appDir,
  dataDir,
  script,
  account,
}) => {
  const login = ACCOUNTS[account];
  const lines = [
    "<service>",
    `  <id>${id}</id>`,
    `  <name>${escapeXml(name)}</name>`,
    `  <description>${escapeXml(description)}</description>`,
    `  <executable>${escapeXml(path.join(appDir, "node", "node.exe"))}</executable>`,
    `  <arguments>--env-file="${escapeXml(dataPaths(dataDir).env)}" "${escapeXml(script)}"</arguments>`,
    `  <workingdirectory>${escapeXml(path.dirname(script))}</workingdirectory>`,
    `  <env name="PATH" value="${escapeXml(path.join(appDir, "ffmpeg", "bin"))};%PATH%"/>`,
    `  <depend>${POSTGRES_SERVICE}</depend>`,
    "  <startmode>Automatic</startmode>",
    // Ctrl+C reaches Node as SIGINT, so jobs and requests finish first.
    "  <stoptimeout>30 sec</stoptimeout>",
    '  <onfailure action="restart" delay="10 sec"/>',
    '  <onfailure action="restart" delay="30 sec"/>',
    "  <resetfailure>1 hour</resetfailure>",
    `  <logpath>${escapeXml(dataPaths(dataDir).logs)}</logpath>`,
    '  <log mode="roll-by-size">',
    "    <sizeThreshold>10240</sizeThreshold>",
    "    <keepFiles>8</keepFiles>",
    "  </log>",
  ];
  if (login) {
    lines.push(
      "  <serviceaccount>",
      `    <domain>${login.domain}</domain>`,
      `    <user>${login.user}</user>`,
      "  </serviceaccount>",
    );
  }
  lines.push("</service>", "");
  return lines.join("\r\n");
};

export const SERVICES = [
  {
    id: "StaaashWeb",
    name: "Staaash Web",
    description: "Staaash web app and API.",
    script: ["app", "start-web.mjs"],
  },
  {
    id: "StaaashWorker",
    name: "Staaash Worker",
    description: "Staaash background jobs: thumbnails, zip downloads, cleanup.",
    script: ["app", "worker", "dist", "index.js"],
  },
];

const run = (command, args, { allowFailure = false, env } = {}) => {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    if (allowFailure) return null;
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new SetupError(`${path.basename(command)} failed. ${detail}`);
  }
};

const serviceExists = (id) =>
  run("sc.exe", ["query", id], { allowFailure: true }) !== null;

// sc.exe translates its labels on non-English Windows; this enum name is fixed.
const serviceState = (id) =>
  run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", `(Get-Service ${id}).Status`],
    { allowFailure: true },
  )?.trim() || "Missing";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForState = async (id, wanted, timeoutMs = 90_000) => {
  const giveUpAt = Date.now() + timeoutMs;
  while (Date.now() < giveUpAt) {
    const state = serviceState(id);
    if (state === wanted || (wanted === "Stopped" && state === "Missing")) {
      return;
    }
    await sleep(500);
  }
  throw new SetupError(`The ${id} service did not reach ${wanted}.`);
};

const stopServices = async () => {
  // The worker and web app first, so the database outlives their last write.
  for (const id of [
    ...SERVICES.map((service) => service.id),
    POSTGRES_SERVICE,
  ]) {
    if (!serviceExists(id)) continue;
    run("sc.exe", ["stop", id], { allowFailure: true });
    await waitForState(id, "Stopped");
  }
};

// The web port is not in use yet on a first install, so skip it by name.
const freePort = (start, skip) =>
  new Promise((resolve, reject) => {
    if (start === skip) return resolve(freePort(start + 1, skip));
    const server = net.createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE" && start < 65_000)
        resolve(freePort(start + 1, skip));
      else reject(error);
    });
    server.listen(start, "127.0.0.1", () => server.close(() => resolve(start)));
  });

const whoAmI = () => run("whoami.exe", []).trim();

const lockDataFolder = (dataDir, { firstInstall }) => {
  // Other people who can sign in to this computer must not read the drive.
  run("icacls.exe", [
    dataDir,
    "/inheritance:r",
    "/grant:r",
    `${SID.system}:(OI)(CI)F`,
    `${SID.administrators}:(OI)(CI)F`,
    `${SID.networkService}:(OI)(CI)M`,
  ]);
  // A folder picked on first install may hold files with their own grants.
  // Updates skip this: everything there was made under the lock.
  if (firstInstall && readdirSync(dataDir).length > 0) {
    run("icacls.exe", [path.join(dataDir, "*"), "/reset", "/T", "/C", "/Q"]);
  }
};

const lockEnvFile = (envFile) => {
  run("icacls.exe", [
    envFile,
    "/inheritance:r",
    "/grant:r",
    `${SID.system}:F`,
    `${SID.administrators}:F`,
    `${SID.networkService}:R`,
  ]);
};

const initDatabase = ({ appDir, paths, password, port }) => {
  const pgBin = path.join(appDir, "pgsql", "bin");
  // initdb runs without admin rights, so it reads this from the user's temp.
  const passwordDir = mkdtempSync(path.join(os.tmpdir(), "staaash-initdb-"));
  const passwordFile = path.join(passwordDir, "password");
  // A new cluster appears under its final name only once it is complete, so
  // an interrupted first install can simply run again.
  const draft = `${paths.postgres}.new`;
  rmSync(draft, { recursive: true, force: true });
  // initdb drops admin rights, so the installing account needs its own grant.
  const installer = whoAmI();
  mkdirSync(draft);
  run("icacls.exe", [draft, "/grant", `${installer}:(OI)(CI)F`]);
  writeFileSync(passwordFile, password);
  try {
    run(path.join(pgBin, "initdb.exe"), [
      "-D",
      draft,
      "-U",
      "staaash",
      "--pwfile",
      passwordFile,
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale-provider=builtin",
      "--builtin-locale=C.UTF-8",
    ]);
  } finally {
    rmSync(passwordDir, { recursive: true, force: true });
  }
  const logDir = path.join(paths.logs, "postgres").replaceAll("\\", "/");
  writeFileSync(
    path.join(draft, "postgresql.conf"),
    [
      "",
      "# Staaash: only this computer reaches the database.",
      "listen_addresses = '127.0.0.1'",
      `port = ${port}`,
      "logging_collector = on",
      `log_directory = '${logDir.replaceAll("'", "''")}'`,
      "log_rotation_size = 10MB",
      "",
    ].join("\n"),
    { flag: "a" },
  );
  run("icacls.exe", [draft, "/remove:g", installer]);
  renameSync(draft, paths.postgres);
};

// Exit codes 1638 (a newer runtime is present) and 3010 (reboot pending) are fine.
const installRuntime = (appDir) => {
  try {
    execFileSync(
      path.join(appDir, "redist", "vc_redist.x64.exe"),
      ["/install", "/quiet", "/norestart"],
      { stdio: "ignore", windowsHide: true },
    );
  } catch (error) {
    if (![1638, 3010].includes(error.status)) {
      throw new SetupError(
        `The Visual C++ runtime did not install (exit code ${error.status}).`,
      );
    }
  }
};

// Checked on every run, so a first install that stopped before this step
// still gets its database when the installer runs again.
const ensureDatabase = ({ appDir, databaseUrl }) => {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  const bin = (tool) => path.join(appDir, "pgsql", "bin", tool);
  const connection = ["-h", url.hostname, "-p", url.port, "-U", url.username];
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
  const found = run(
    bin("psql.exe"),
    [
      ...connection,
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname = '${name.replaceAll("'", "''")}'`,
    ],
    { env },
  ).trim();
  if (found !== "1") run(bin("createdb.exe"), [...connection, name], { env });
};

const registerPostgres = ({ appDir, paths }) => {
  const pgCtl = path.join(appDir, "pgsql", "bin", "pg_ctl.exe");
  if (serviceExists(POSTGRES_SERVICE)) {
    run(pgCtl, ["unregister", "-N", POSTGRES_SERVICE]);
  }
  run(pgCtl, [
    "register",
    "-N",
    POSTGRES_SERVICE,
    "-U",
    "NT AUTHORITY\\NetworkService",
    "-D",
    paths.postgres,
    "-S",
    "auto",
    "-w",
  ]);
};

const registerAppServices = ({ appDir, dataDir, account }) => {
  for (const service of SERVICES) {
    const wrapper = path.join(appDir, "services", `${service.id}.exe`);
    // An update replaced the services folder, so WinSW needs its XML back
    // before it can remove the old registration.
    writeFileSync(
      path.join(appDir, "services", `${service.id}.xml`),
      renderServiceXml({
        ...service,
        appDir,
        dataDir,
        script: path.join(appDir, ...service.script),
        account,
      }),
    );
    if (serviceExists(service.id)) run(wrapper, ["uninstall"]);
    run(wrapper, ["install"]);
  }
};

const setFirewall = ({ port, open }) => {
  run(
    "netsh.exe",
    ["advfirewall", "firewall", "delete", "rule", `name=${FIREWALL_RULE}`],
    {
      allowFailure: true,
    },
  );
  if (!open) return;
  run("netsh.exe", [
    "advfirewall",
    "firewall",
    "add",
    "rule",
    `name=${FIREWALL_RULE}`,
    "dir=in",
    "action=allow",
    "protocol=TCP",
    `localport=${port}`,
  ]);
};

const getJson = async (url) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  return response.ok ? response.json() : null;
};

// A new instance is not ready until its owner signs up: storage switches to
// its current format only after setup. Until then, a working setup page is
// as healthy as it gets.
const waitForHealth = async ({ port, logs, answering = false }) => {
  const origin = `http://127.0.0.1:${port}`;
  const giveUpAt = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < giveUpAt) {
    try {
      const entry = await getJson(`${origin}/api/views/entry`);
      if (entry?.state === "setup" || (entry && answering)) return;
      if (entry && (await getJson(`${origin}/api/health/ready`))?.ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(1_000);
  }
  throw new SetupError(
    `Staaash did not start. See the logs in ${logs}.`,
    EXIT.unhealthy,
  );
};

const install = async ({ appDir, dataDir, port, account, firewall }) => {
  const paths = dataPaths(dataDir);
  // A running service cannot be registered again, so a re-run stops first.
  await stopServices();
  installRuntime(appDir);
  mkdirSync(dataDir, { recursive: true });
  lockDataFolder(dataDir, { firstInstall: !existsSync(paths.env) });
  mkdirSync(paths.files, { recursive: true });
  mkdirSync(paths.logs, { recursive: true });

  // An update keeps the settings and database password already in place.
  const settings = existsSync(paths.env)
    ? parseEnvFile(readFileSync(paths.env, "utf8"))
    : {};
  if (!settings.DATABASE_URL) {
    if (existsSync(paths.postgres)) {
      throw new SetupError(
        `${paths.postgres} exists but ${paths.env} is missing. ` +
          "Restore the settings file from your backup.",
      );
    }
    const newDatabase = {
      password: randomBytes(24).toString("hex"),
      port: await freePort(5433, port),
    };
    initDatabase({ appDir, paths, ...newDatabase });
    settings.DATABASE_URL = `postgresql://staaash:${newDatabase.password}@127.0.0.1:${newDatabase.port}/staaash`;
  }
  Object.assign(settings, {
    NODE_ENV: "production",
    PORT: String(port),
    UPLOAD_LOCATION: paths.files,
  });
  writeFileSync(paths.env, renderEnvFile(settings));
  lockEnvFile(paths.env);

  registerPostgres({ appDir, paths });
  registerAppServices({ appDir, dataDir, account });
  setFirewall({ port, open: firewall });

  run("sc.exe", ["start", POSTGRES_SERVICE]);
  await waitForState(POSTGRES_SERVICE, "Running");
  ensureDatabase({ appDir, databaseUrl: settings.DATABASE_URL });
  // The web service migrates the database before it listens, and the worker
  // needs those tables, so it starts once the web service answers.
  const [web, worker] = SERVICES;
  run("sc.exe", ["start", web.id]);
  await waitForHealth({ port, logs: paths.logs, answering: true });
  run("sc.exe", ["start", worker.id]);
  await waitForState(worker.id, "Running");
  await waitForHealth({ port, logs: paths.logs });
};

const uninstall = async ({ appDir }) => {
  await stopServices();
  for (const service of SERVICES) {
    if (serviceExists(service.id)) {
      run(path.join(appDir, "services", `${service.id}.exe`), ["uninstall"]);
    }
  }
  if (serviceExists(POSTGRES_SERVICE)) {
    run(path.join(appDir, "pgsql", "bin", "pg_ctl.exe"), [
      "unregister",
      "-N",
      POSTGRES_SERVICE,
    ]);
  }
  setFirewall({ open: false });
};

const main = async (argv) => {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      app: { type: "string" },
      data: { type: "string" },
      port: { type: "string", default: "2113" },
      account: { type: "string", default: "NetworkService" },
      firewall: { type: "string", default: "1" },
      installed: { type: "string", default: "" },
      version: { type: "string" },
    },
  });
  // Checked for every command, so precheck refuses a bad silent update
  // before the installer stops anything.
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new SetupError(`Port ${values.port} is not a valid port.`);
  }
  if (!Object.hasOwn(ACCOUNTS, values.account)) {
    throw new SetupError(`Unknown account ${values.account}.`);
  }
  if (command === "precheck") {
    return precheck({
      installed: values.installed,
      version: values.version,
      appDir: values.app,
      dataDir: values.data,
    });
  }
  if (command === "stop") return stopServices();
  if (command === "install") {
    return install({
      appDir: values.app,
      dataDir: values.data,
      port,
      account: values.account,
      firewall: values.firewall === "1",
    }).catch((error) => {
      // A silent install has no window to show the message in.
      const { logs } = dataPaths(values.data);
      mkdirSync(logs, { recursive: true });
      appendFileSync(
        path.join(logs, "setup.log"),
        `${new Date().toISOString()} ${error.message}\n`,
      );
      throw error;
    });
  }
  if (command === "uninstall") return uninstall({ appDir: values.app });
  throw new SetupError(`Unknown command ${command}.`);
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    () => process.exit(EXIT.ok),
    (error) => {
      console.error(error.message);
      process.exit(error.exitCode ?? EXIT.failed);
    },
  );
}
