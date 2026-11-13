import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const image = process.env.STAAASH_TEST_IMAGE;

test(
  "production startup waits for long migrations and blocks migration failures",
  {
    skip: !image,
    timeout: 480_000,
  },
  (t) => {
    const project = `staaash-startup-${randomBytes(6).toString("hex")}`;
    const scratch = mkdtempSync(path.join(tmpdir(), `${project}-`));
    const evidence = path.resolve(".data/ci", project);
    mkdirSync(evidence, { recursive: true });
    const override = path.join(scratch, "override.json");
    const config = {
      services: {
        migrate: {
          container_name: `${project}-migrate`,
          image,
          command: ["sh", "-c", "sleep 200; prisma migrate deploy"],
          restart: "no",
          cpus: 0.5,
          mem_limit: "1g",
        },
        staaash: {
          container_name: `${project}-web`,
          image,
          ports: [],
          volumes: ["startup-files:/data/files"],
          restart: "no",
          cpus: 0.5,
          mem_limit: "1g",
        },
        worker: {
          container_name: `${project}-worker`,
          image,
          volumes: ["startup-files:/data/files"],
          restart: "no",
          cpus: 2,
          mem_limit: "512m",
        },
        db: {
          container_name: `${project}-db`,
          volumes: ["startup-db:/var/lib/postgresql"],
          restart: "no",
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
    for (const [name, service] of Object.entries(config.services)) {
      const original = isolated.services[name];
      Object.assign(original, service);
      if (name === "staaash")
        original.ports = [
          {
            target: 2113,
            published: "0",
            host_ip: "127.0.0.1",
            protocol: "tcp",
          },
        ];
      if (name !== "migrate")
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
    const worker = inspect("worker");
    const web = inspect("web");
    const migration = inspect("migrate");
    assert.equal(migration.State.Status, "exited");
    assert.equal(migration.State.ExitCode, 0);
    for (const service of [web, worker]) {
      assert.ok(
        Date.parse(service.State.StartedAt) >=
          Date.parse(migration.State.FinishedAt),
      );
    }
    assert.equal(worker.RestartCount, 0);
    assert.equal(worker.State.Status, "running");
    writeFileSync(
      path.join(evidence, "startup.json"),
      JSON.stringify({
        migration: migration.State,
        web: web.State,
        worker: worker.State,
      }),
    );
    writeFileSync(
      path.join(evidence, "fresh.log"),
      compose("logs", "--no-color", "--timestamps"),
    );

    compose("down", "--volumes", "--remove-orphans");
    isolated.services.migrate.command = [
      "sh",
      "-c",
      "DATABASE_URL=postgresql://postgres:wrong@db:5432/staaash prisma migrate deploy",
    ];
    saveConfig();
    assert.throws(() => compose("up", "-d"));
    assert.match(compose("logs", "--no-color", "migrate"), /P1000/);
    assert.equal(inspect("web").State.Status, "created");
    assert.equal(
      inspect("worker").State.Status,
      "created",
      "failed migrations must prevent worker startup",
    );
  },
);

test("the HTTPS file puts Caddy in front and closes the direct port", () => {
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
        },
      },
    ),
  );
  assert.equal(config.services.staaash.ports, undefined);
  assert.deepEqual(
    config.services.caddy.ports.map((port) => port.published),
    ["80", "443"],
  );
  assert.equal(
    config.services.caddy.depends_on.staaash.condition,
    "service_healthy",
  );
});
