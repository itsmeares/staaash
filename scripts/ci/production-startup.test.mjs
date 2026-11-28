import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const image = process.env.STAAASH_TEST_IMAGE;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  "production startup waits for long migrations, blocks failed ones, and survives any restart policy",
  {
    skip: !image,
    timeout: 480_000,
  },
  async (t) => {
    const project = `staaash-startup-${randomBytes(6).toString("hex")}`;
    const scratch = mkdtempSync(path.join(tmpdir(), `${project}-`));
    const evidence = path.resolve(".data/ci", project);
    mkdirSync(evidence, { recursive: true });
    const override = path.join(scratch, "override.json");
    // CasaOS rewrites restart policies to unless-stopped when it saves an
    // app, so startup must not need any container to stay stopped.
    const config = {
      services: {
        staaash: {
          container_name: `${project}-web`,
          image,
          // A migration much longer than the web health deadline below.
          command: [
            "sh",
            "-c",
            "sleep 25; prisma migrate deploy && node dist/server/main.mjs",
          ],
          ports: [],
          volumes: ["startup-files:/data/files"],
          restart: "unless-stopped",
          cpus: 0.5,
          mem_limit: "1g",
        },
        worker: {
          container_name: `${project}-worker`,
          image,
          volumes: ["startup-files:/data/files"],
          restart: "unless-stopped",
          cpus: 2,
          mem_limit: "512m",
        },
        db: {
          container_name: `${project}-db`,
          volumes: ["startup-db:/var/lib/postgresql"],
          restart: "unless-stopped",
          cpus: 0.5,
          mem_limit: "512m",
        },
      },
      volumes: { "startup-files": {}, "startup-db": {} },
    };
    const base = execFileSync(
      "docker",
      ["compose", "-f", "docker-compose.yml", "config", "--format", "json"],
      {
        encoding: "utf8",
        env: { ...process.env, DB_PASSWORD: "startup-test-only" },
      },
    );
    const isolated = JSON.parse(base);
    assert.deepEqual(Object.keys(isolated.services).sort(), [
      "db",
      "staaash",
      "worker",
    ]);
    for (const [name, service] of Object.entries(config.services)) {
      const original = isolated.services[name];
      Object.assign(original, service);
      if (name === "staaash") {
        original.ports = [
          {
            target: 2113,
            published: "0",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
        ];
        // A health deadline of about 8 s, well under the fake migration, so a
        // start that waited on web health would fail here.
        original.healthcheck = {
          ...original.healthcheck,
          interval: "2s",
          timeout: "2s",
          retries: 3,
          start_period: "2s",
        };
      }
      original.volumes = [
        {
          type: "volume",
          source: name === "db" ? "startup-db" : "startup-files",
          target: name === "db" ? "/var/lib/postgresql" : "/data/files",
        },
      ];
    }
    isolated.volumes = config.volumes;
    isolated.networks = { default: {} };
    const saveConfig = () => writeFileSync(override, JSON.stringify(isolated));
    saveConfig();
    const compose = (...args) =>
      execFileSync(
        "docker",
        ["compose", "-p", project, "-f", override, ...args],
        {
          encoding: "utf8",
          timeout: 360_000,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    const inspect = (name) =>
      JSON.parse(
        execFileSync("docker", ["inspect", `${project}-${name}`], {
          encoding: "utf8",
        }),
      )[0];
    const logs = (service) => compose("logs", "--no-color", service);
    const waitForLog = async (service, pattern, label) => {
      const deadline = Date.now() + 180_000;
      while (!pattern.test(logs(service))) {
        assert.ok(Date.now() < deadline, `timed out waiting for ${label}`);
        await delay(2_000);
      }
    };
    t.after(() => {
      try {
        writeFileSync(
          path.join(evidence, "compose.log"),
          compose("logs", "--no-color", "--timestamps"),
        );
      } finally {
        compose("down", "--volumes", "--remove-orphans");
        rmSync(scratch, { recursive: true });
      }
    });

    compose("up", "-d");
    await waitForLog(
      "worker",
      /Waiting for database migrations/,
      "the worker to wait",
    );
    await waitForLog(
      "staaash",
      /All migrations have been successfully applied/,
      "the migrations",
    );
    await waitForLog("staaash", /Staaash is listening/, "the web server");
    await waitForLog(
      "worker",
      /Database migrations done/,
      "the worker to start after the migrations",
    );
    // Its next step queries the database and waits for the owner account.
    await waitForLog(
      "worker",
      /Storage protocol cutover waiting for instance setup/,
      "the worker's first queries",
    );
    const worker = inspect("worker");
    const web = inspect("web");
    assert.equal(web.State.Status, "running");
    assert.equal(worker.State.Status, "running");
    assert.equal(web.RestartCount, 0);
    assert.equal(worker.RestartCount, 0, "the worker must wait, not crash");
    assert.doesNotMatch(logs("worker"), /Fatal startup error/);
    writeFileSync(
      path.join(evidence, "startup.json"),
      JSON.stringify({ web: web.State, worker: worker.State }),
    );
    writeFileSync(
      path.join(evidence, "fresh.log"),
      compose("logs", "--no-color", "--timestamps"),
    );

    compose("down", "--volumes", "--remove-orphans");
    isolated.services.staaash.command = [
      "sh",
      "-c",
      "DATABASE_URL=postgresql://postgres:wrong@db:5432/staaash prisma migrate deploy && node dist/server/main.mjs",
    ];
    isolated.services.staaash.restart = "no";
    saveConfig();
    compose("up", "-d");
    await waitForLog("staaash", /P1000/, "the failed migration");
    await waitForLog(
      "worker",
      /Waiting for database migrations/,
      "the worker to wait",
    );
    await delay(10_000);
    assert.equal(inspect("web").State.Status, "exited");
    assert.notEqual(inspect("web").State.ExitCode, 0);
    assert.doesNotMatch(logs("staaash"), /Staaash is listening/);
    assert.equal(inspect("worker").State.Status, "running");
    assert.doesNotMatch(
      logs("worker"),
      /Database migrations done|Storage protocol|Fatal startup error/,
      "failed migrations must keep the worker waiting",
    );
  },
);

test("the HTTPS file puts Caddy in front of a local-only Staaash port", () => {
  const config = JSON.parse(
    execFileSync(
      "docker",
      [
        "compose",
        "-f",
        "docker-compose.yml",
        "-f",
        "compose.https.yml",
        "config",
        "--format",
        "json",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          DB_PASSWORD: "startup-test-only",
          STAAASH_PUBLIC_URL: "https://drive.example.com",
          STAAASH_PORT: "127.0.0.1:2113",
        },
      },
    ),
  );
  assert.deepEqual(
    config.services.staaash.ports.map((port) => port.host_ip),
    ["127.0.0.1"],
  );
  assert.deepEqual(
    config.services.caddy.ports.map((port) => port.published),
    ["80", "443"],
  );
  assert.equal(
    config.services.caddy.depends_on.staaash.condition,
    "service_healthy",
  );
});
