import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  EXIT,
  parseEnvFile,
  precheck,
  renderEnvFile,
  renderServiceXml,
} from "./setup.mjs";

const withData = (pgVersion, run) => {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "staaash-setup-"));
  try {
    if (pgVersion) {
      mkdirSync(path.join(dataDir, "postgres"));
      writeFileSync(
        path.join(dataDir, "postgres", "PG_VERSION"),
        `${pgVersion}\n`,
      );
    }
    run(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
};

const appDir = path.join(os.tmpdir(), "Staaash Server");

test("precheck allows a first install, the same version, and newer ones", () => {
  withData(null, (dataDir) => {
    precheck({ installed: "", version: "2.0.0", appDir, dataDir });
    precheck({ installed: "2.0.0", version: "2.0.0", appDir, dataDir });
    precheck({ installed: "2.0.0-rc.5", version: "2.0.0", appDir, dataDir });
    precheck({ installed: "2.0.0", version: "2.1.0", appDir, dataDir });
  });
});

test("precheck refuses a downgrade before anything changes", () => {
  withData("18", (dataDir) => {
    assert.throws(
      () => precheck({ installed: "2.1.0", version: "2.0.0", appDir, dataDir }),
      (error) =>
        error.exitCode === EXIT.downgrade &&
        /restore the backup/.test(error.message),
    );
    assert.throws(
      () =>
        precheck({
          installed: "2.0.0",
          version: "2.0.0-rc.5",
          appDir,
          dataDir,
        }),
      (error) => error.exitCode === EXIT.downgrade,
    );
  });
});

test("precheck refuses a database from another PostgreSQL major", () => {
  withData("18", (dataDir) =>
    precheck({ installed: "2.0.0", version: "2.1.0", appDir, dataDir }),
  );
  withData("17", (dataDir) => {
    assert.throws(
      () => precheck({ installed: "2.0.0", version: "2.1.0", appDir, dataDir }),
      (error) =>
        error.exitCode === EXIT.postgres &&
        /left untouched/.test(error.message),
    );
  });
});

test("precheck refuses a data folder inside the program folder", () => {
  for (const name of ["data", "..data"]) {
    assert.throws(
      () =>
        precheck({
          installed: "",
          version: "2.0.0",
          appDir,
          dataDir: path.join(appDir, name),
        }),
      /outside the Staaash Server program folder/,
    );
  }
});

test("settings survive a write and read", () => {
  const settings = {
    DATABASE_URL: "postgresql://staaash:secret@127.0.0.1:5433/staaash",
    UPLOAD_LOCATION: "D:\\Staaash Data\\files",
    PORT: "2113",
  };
  assert.deepEqual(parseEnvFile(renderEnvFile(settings)), settings);
  assert.deepEqual(parseEnvFile("# note\r\n\r\nA = b=c\n"), { A: "b=c" });
});

test("service config runs Node with the settings file as the chosen account", () => {
  const options = {
    id: "StaaashWorker",
    name: "Staaash Worker",
    description: "Jobs & cleanup",
    appDir: "C:\\Program Files\\Staaash Server",
    dataDir: "D:\\Staaash",
    script: "C:\\Program Files\\Staaash Server\\app\\worker\\dist\\index.js",
  };
  const network = renderServiceXml({ ...options, account: "NetworkService" });
  assert.match(network, /<description>Jobs &amp; cleanup<\/description>/);
  assert.match(network, /<depend>StaaashPostgres<\/depend>/);
  assert.match(
    network,
    /<domain>NT AUTHORITY<\/domain>\s*<user>NetworkService<\/user>/,
  );
  assert.ok(network.includes("<logpath>"));
  assert.ok(
    network.includes(`--env-file="${path.join("D:\\Staaash", "staaash.env")}"`),
  );

  const system = renderServiceXml({ ...options, account: "LocalSystem" });
  assert.doesNotMatch(system, /serviceaccount/);
});
