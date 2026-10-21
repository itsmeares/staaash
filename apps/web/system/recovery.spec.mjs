import { execFileSync } from "node:child_process";
import pg from "pg";
import { test, expect } from "@playwright/test";
import {
  createStack,
  destroyStack,
  startApp,
  startDatabase,
} from "../../../scripts/ci/stack.mjs";
import {
  account,
  anonymous,
  archive,
  auditTotals,
  compose,
  downloaded,
  hash,
  json,
  mediaFixture,
  reconcile,
  signedIn,
  sql,
  stack,
  unique,
  upload,
  waitFor,
} from "./support.mjs";

test("the worker reconnects after a database restart and finishes the next job", async () => {
  const owner = await signedIn();
  try {
    const state = await stack();
    const bytes = Buffer.from("kept through database restart");
    const file = await upload(owner, `${unique("restart")}.txt`, bytes);
    compose(state, ["restart", "db"]);
    await startDatabase(state);
    await waitFor(
      async () => (await fetch(`${state.origin}/api/health/ready`)).ok,
      "worker and database reconnection",
    );
    await archive(owner, [{ id: file.id, name: file.name, bytes }]);
    await downloaded(owner, file.id, bytes);
    await auditTotals();
  } finally {
    await owner.dispose();
  }
});

test("small thumbnails and archives finish while a general conversion is paused, and cancellation kills it", async () => {
  test.setTimeout(180_000);
  const state = await stack();
  const owner = await signedIn();
  let pid;
  try {
    const smallBytes = await mediaFixture("small.mp4");
    const largeBytes = await mediaFixture("large.mp4", 60);
    const big = await upload(owner, `${unique("general")}.mp4`, largeBytes, {
      mimeType: "video/mp4",
    });
    const small = await upload(owner, `${unique("small")}.mp4`, smallBytes, {
      mimeType: "video/mp4",
    });
    await json(owner, `/api/files/files/${big.id}/derivative`, {});
    await waitFor(
      () => {
        const line = compose(state, [
          "exec",
          "-T",
          "worker",
          "ps",
          "-o",
          "pid,args",
        ])
          .split("\n")
          .find((item) => item.includes("ffmpeg") && item.includes(big.name));
        pid = line?.trim().split(/\s+/)[0];
        return Boolean(pid);
      },
      "the known test conversion child",
      20_000,
    );
    compose(state, ["exec", "-T", "worker", "kill", "-STOP", pid]);
    await expect
      .poll(
        async () =>
          (await owner.get(`/api/files/files/${small.id}/thumbnail`)).status(),
        { timeout: 45_000 },
      )
      .toBe(200);
    await archive(owner, [
      { id: small.id, name: small.name, bytes: smallBytes },
    ]);
    const [job] = await sql(
      `SELECT id, status FROM "BackgroundJob" WHERE kind='media.derivative.generate' AND "payloadJson"->>'fileId'=$1 AND "payloadJson"->>'kind'='preview' ORDER BY "createdAt" DESC LIMIT 1`,
      [big.id],
    );
    expect(job.status).toBe("running");
    await json(owner, `/api/admin/jobs/${job.id}/cancel`, {});
    await expect
      .poll(
        async () =>
          (
            await sql('SELECT status FROM "BackgroundJob" WHERE id=$1', [
              job.id,
            ])
          )[0].status,
        { timeout: 20_000 },
      )
      .toBe("cancelled");
    await expect
      .poll(
        () => {
          try {
            compose(state, ["exec", "-T", "worker", "kill", "-0", pid], {
              stdio: "pipe",
            });
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 15_000 },
      )
      .toBe(false);
    pid = undefined;
    await downloaded(owner, big.id, largeBytes);
  } finally {
    if (pid) compose(state, ["exec", "-T", "worker", "kill", "-CONT", pid]);
    await owner.dispose();
  }
});

test("a worker killed during publication recovers exactly one generated result", async () => {
  const state = await stack();
  const owner = await signedIn();
  const lock = new pg.Client({ connectionString: state.databaseUrl });
  await lock.connect();
  const lockId = 715022001;
  let trigger = false;
  try {
    const bytes = await mediaFixture("publication.mp4");
    const file = await upload(owner, `${unique("publication")}.mp4`, bytes, {
      mimeType: "video/mp4",
    });
    await lock.query("SELECT pg_advisory_lock($1)", [lockId]);
    await sql(`CREATE FUNCTION staaash_test_pause_publish() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.status='ready' AND NEW."fileId"='${file.id}' THEN PERFORM pg_advisory_xact_lock(${lockId}); END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER staaash_test_pause_publish BEFORE UPDATE ON "MediaDerivative" FOR EACH ROW EXECUTE FUNCTION staaash_test_pause_publish()`);
    trigger = true;
    await json(owner, `/api/files/files/${file.id}/derivative`, {});
    await waitFor(
      async () =>
        (
          await sql(
            "SELECT pid FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%MediaDerivative%'",
          )
        ).length > 0,
      "publication metadata waiting after its filesystem move",
      30_000,
    );
    const mutations = await sql(
      `SELECT id FROM "StorageMutation" WHERE status IN ('prepared','running','retrying','metadata_committed','finalizing')`,
    );
    expect(mutations.length).toBeGreaterThan(0);
    compose(state, ["kill", "-s", "SIGKILL", "worker"]);
    await lock.query("SELECT pg_advisory_unlock($1)", [lockId]);
    await sql(
      'DROP TRIGGER staaash_test_pause_publish ON "MediaDerivative"; DROP FUNCTION staaash_test_pause_publish()',
    );
    trigger = false;
    await sql(`UPDATE "BackgroundJob" SET "leaseExpiresAt"=NOW()-INTERVAL '1 minute' WHERE status='running';
      UPDATE "StorageMutation" SET "leaseExpiresAt"=NOW()-INTERVAL '1 minute' WHERE status IN ('prepared','running','retrying','metadata_committed','finalizing')`);
    compose(state, ["up", "-d", "worker"]);
    await expect
      .poll(
        async () =>
          (
            await (
              await owner.get(`/api/files/files/${file.id}/derivative`)
            ).json()
          ).status,
        { timeout: 60_000 },
      )
      .toBe("ready");
    expect(
      await sql(
        `SELECT status FROM "MediaDerivative" WHERE "fileId"=$1 AND kind='preview'`,
        [file.id],
      ),
    ).toEqual([{ status: "ready" }]);
    for (const mutation of mutations)
      expect(
        (
          await sql('SELECT status FROM "StorageMutation" WHERE id=$1', [
            mutation.id,
          ])
        )[0].status,
      ).toBe("succeeded");
    await downloaded(owner, file.id, bytes);
    await auditTotals();
  } finally {
    await lock.query("SELECT pg_advisory_unlock_all()");
    if (trigger)
      await sql(
        'DROP TRIGGER staaash_test_pause_publish ON "MediaDerivative"; DROP FUNCTION staaash_test_pause_publish()',
      );
    await lock.end();
    compose(state, ["up", "-d", "worker"]);
    await owner.dispose();
  }
});

test("inconsistent usage blocks web and worker startup before recovery changes files", async () => {
  const state = await stack();
  const owner = await signedIn();
  const member = await account(owner);
  let corrupted = false;
  const repair = async () => {
    compose(state, ["stop", "web", "worker"]);
    await sql(`ALTER TABLE "User" DISABLE TRIGGER "User_protect_storage_usage";
      UPDATE "User" u SET "committedStorageBytes"=COALESCE((SELECT SUM("sizeBytes") FROM "File" f WHERE f."ownerUserId"=u.id),0);
      ALTER TABLE "User" ENABLE TRIGGER "User_protect_storage_usage"`);
    await startApp(state, false);
    corrupted = false;
  };
  try {
    const bytes = Buffer.from("safe original");
    const file = await upload(member.api, "Safe.txt", bytes);
    const before = await sql(
      'SELECT id, "storageKey", "storageRevision", "sizeBytes", "contentChecksum" FROM "File" ORDER BY id',
    );
    compose(state, ["stop", "web", "worker"]);
    await sql(
      'ALTER TABLE "User" DISABLE TRIGGER "User_protect_storage_usage"',
    );
    await sql('UPDATE "User" SET "committedStorageBytes"=999 WHERE id=$1', [
      member.user.id,
    ]);
    await sql('ALTER TABLE "User" ENABLE TRIGGER "User_protect_storage_usage"');
    corrupted = true;
    compose(state, ["up", "-d", "web", "worker"]);
    const worker = compose(state, ["ps", "-a", "-q", "worker"]).trim();
    await waitFor(
      () =>
        execFileSync(
          "docker",
          ["inspect", "--format", "{{.State.Status}}", worker],
          { encoding: "utf8" },
        ).trim() === "exited",
      "the worker's startup safety stop",
      30_000,
    );
    expect(
      Number(
        execFileSync(
          "docker",
          ["inspect", "--format", "{{.State.ExitCode}}", worker],
          { encoding: "utf8" },
        ).trim(),
      ),
    ).not.toBe(0);
    expect((await owner.get("/api/health/ready")).status()).toBe(500);
    expect(
      await sql('SELECT "committedStorageBytes" FROM "User" WHERE id=$1', [
        member.user.id,
      ]),
    ).toEqual([{ committedStorageBytes: null }]);
    expect(
      await sql(
        'SELECT id, "storageKey", "storageRevision", "sizeBytes", "contentChecksum" FROM "File" ORDER BY id',
      ),
    ).toEqual(before);
    await repair();
    await downloaded(member.api, file.id, bytes);
    await auditTotals();
  } finally {
    if (corrupted) await repair();
    await Promise.all([owner.dispose(), member.api.dispose()]);
  }
});

test("a stopped backup restores files, accounts and public links into a separate instance", async () => {
  test.setTimeout(180_000);
  const state = await stack();
  const owner = await signedIn();
  const clone = await createStack(state.image);
  let restored;
  try {
    const bytes = Buffer.from("backup original bytes");
    const file = await upload(owner, `${unique("backup")}.txt`, bytes);
    const { share } = await json(
      owner,
      "/api/shares",
      {
        targetType: "file",
        fileId: file.id,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      201,
    );
    await reconcile(owner);
    compose(state, ["stop", "web"]);
    await waitFor(
      async () =>
        (
          await sql(
            `SELECT id FROM "StorageMutation" WHERE status NOT IN ('succeeded','aborted')`,
          )
        ).length === 0,
      "journal drain before backup",
    );
    compose(state, ["stop", "worker"]);
    const database = compose(state, [
      "exec",
      "-T",
      "db",
      "pg_dump",
      "-U",
      "test",
      "--no-owner",
      "--no-privileges",
      state.database,
    ]);
    const files = compose(
      state,
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "tar",
        "web",
        "-C",
        "/data/files",
        "-cf",
        "-",
        ".",
      ],
      { encoding: null },
    );
    await startDatabase(clone);
    compose(
      clone,
      [
        "exec",
        "-T",
        "db",
        "psql",
        "-U",
        "test",
        "-d",
        clone.database,
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: database },
    );
    compose(
      clone,
      [
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "tar",
        "web",
        "-C",
        "/data/files",
        "-xf",
        "-",
      ],
      { input: files },
    );
    await startApp(clone);
    restored = await signedIn("owner", clone.origin);
    await downloaded(restored, file.id, bytes);
    const visitor = await anonymous(clone.origin);
    try {
      const response = await visitor.get(
        `${new URL(share.shareUrl).pathname}/download`,
      );
      expect(response.status()).toBe(200);
      expect(hash(await response.body())).toBe(hash(bytes));
    } finally {
      await visitor.dispose();
    }
    await reconcile(restored);
  } finally {
    await restored?.dispose();
    await destroyStack(clone);
    await startApp(state, false);
    await owner.dispose();
  }
});

test("a mixed library workload keeps complete results and exact bytes", async () => {
  test.setTimeout(180_000);
  const owner = await signedIn();
  const members = await Promise.all([0, 1, 2].map(() => account(owner)));
  const started = Date.now();
  try {
    await Promise.all(
      members.map(async ({ api }) => {
        const { folder } = await json(
          api,
          "/api/files/folders",
          { name: unique("load") },
          201,
        );
        const files = [];
        for (let batch = 0; batch < 5; batch++) {
          const group = await Promise.all(
            Array.from({ length: 5 }, async (_, index) => {
              const bytes = Buffer.from(`Load bytes ${batch}/${index}`);
              const file = await upload(
                api,
                `File-${batch}-${index}.txt`,
                bytes,
                { folderId: folder.id },
              );
              expect((await api.get(`/files/f/${folder.id}`)).status()).toBe(
                200,
              );
              await downloaded(api, file.id, bytes);
              return { ...file, bytes };
            }),
          );
          files.push(...group);
        }
        await archive(api, files);
      }),
    );
    await auditTotals();
    console.log(
      `Mixed workload: 75 uploads, reads and byte checks across three accounts in ${Date.now() - started} ms.`,
    );
  } finally {
    await Promise.all([
      owner.dispose(),
      ...members.map(({ api }) => api.dispose()),
    ]);
  }
});
