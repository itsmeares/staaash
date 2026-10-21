import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { request, expect } from "@playwright/test";
import pg from "pg";

import { compose, waitFor } from "../../../scripts/ci/stack.mjs";

export const origin = process.env.STAAASH_E2E_BASE_URL;
export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const unique = (prefix) => `${prefix}-${randomUUID()}`;

export async function stack() {
  const state = JSON.parse(
    await readFile(process.env.STAAASH_TEST_STATE, "utf8"),
  );
  assert.match(state.project, /^staaash-test-[a-f0-9]{12}$/);
  assert.equal(
    await readFile(path.join(state.root, ".staaash-test-root"), "utf8"),
    state.project,
  );
  assert.equal(new URL(state.databaseUrl).pathname, `/${state.database}`);
  return state;
}

export async function sql(text, values = []) {
  const state = await stack();
  const client = new pg.Client({ connectionString: state.databaseUrl });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
}

export async function anonymous(baseURL = origin) {
  return request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL, Accept: "application/json" },
  });
}

export async function json(api, url, data, status = 200) {
  const response = await api.post(url, { data });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

export async function signedIn(kind = "owner", baseURL = origin) {
  const accounts = JSON.parse(
    await readFile(process.env.STAAASH_E2E_STATE_FILE, "utf8"),
  );
  const api = await anonymous(baseURL);
  await json(api, "/api/auth/sign-in", {
    email: accounts[`${kind}Identifier`],
    password: accounts[`${kind}Password`],
  });
  return api;
}

export async function account(owner, limit = null) {
  const email = `${unique("system")}@staaash.test`;
  const password = "test-only-account-password";
  const { user } = await json(
    owner,
    "/api/admin/users",
    {
      email,
      temporaryPassword: password,
      confirmTemporaryPassword: password,
      requirePasswordChange: false,
      storageLimitBytes: limit,
    },
    201,
  );
  const api = await anonymous();
  await json(api, "/api/auth/sign-in", { email, password });
  await json(api, "/api/user/preferences", { theme: "dark", timeZone: "UTC" });
  return { api, user, email, password };
}

export async function upload(
  api,
  name,
  bytes,
  { folderId, strategy = "fail", mimeType = "text/plain" } = {},
) {
  const response = await api.post("/api/files/files", {
    multipart: {
      files: { name, mimeType, buffer: bytes },
      manifest: JSON.stringify([
        { clientKey: name, originalName: name, conflictStrategy: strategy },
      ]),
      ...(folderId ? { folderId } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const { uploadedFiles } = await response.json();
  expect(uploadedFiles).toHaveLength(1);
  return uploadedFiles[0];
}

export async function downloaded(api, id, bytes) {
  const response = await api.get(`/api/files/files/${id}/download`);
  expect(response.status(), await response.text()).toBe(200);
  expect(hash(await response.body())).toBe(hash(bytes));
}

export async function reconcile(owner) {
  const queued = await json(owner, "/api/admin/integrity", {});
  await expect
    .poll(
      async () => {
        const response = await owner.get("/api/admin/integrity");
        expect(response.ok()).toBe(true);
        const { recentRuns } = await response.json();
        return recentRuns.find((run) => run.backgroundJobId === queued.jobId)
          ?.status;
      },
      { timeout: 60_000 },
    )
    .toBe("succeeded");
  const { latestRun } = await (await owner.get("/api/admin/integrity")).json();
  expect(latestRun.missingOriginalCount).toBe(0);
  expect(latestRun.orphanedStorageCount).toBe(0);
}

export async function auditTotals() {
  expect(
    await sql(`SELECT u.id FROM "User" u LEFT JOIN
    (SELECT "ownerUserId", SUM("sizeBytes") AS bytes FROM "File" GROUP BY "ownerUserId") f
    ON f."ownerUserId" = u.id WHERE u."committedStorageBytes" IS DISTINCT FROM COALESCE(f.bytes, 0)`),
  ).toEqual([]);
  expect(
    await sql(`WITH RECURSIVE tree(root, id) AS (
    SELECT id, id FROM "Folder" WHERE "deletedAt" IS NULL
    UNION SELECT tree.root, child.id FROM tree JOIN "Folder" child ON child."parentId" = tree.id WHERE child."deletedAt" IS NULL
  ), totals AS (SELECT tree.root, SUM(f."sizeBytes") AS bytes FROM tree JOIN "File" f ON f."folderId" = tree.id AND f."deletedAt" IS NULL GROUP BY tree.root)
    SELECT f.id FROM "Folder" f LEFT JOIN totals t ON t.root = f.id
    WHERE f."treeSizeBytes" <> CASE WHEN f."deletedAt" IS NULL THEN COALESCE(t.bytes,0) ELSE 0 END`),
  ).toEqual([]);
}

export async function archive(api, files) {
  const { archiveId } = await json(api, "/api/files/archives", {
    ids: files.map((file) => file.id),
  });
  await expect
    .poll(
      async () =>
        (await (await api.get(`/api/files/archives/${archiveId}`)).json())
          .status,
      { timeout: 60_000 },
    )
    .toBe("ready");
  const response = await api.get(`/api/files/archives/${archiveId}/download`);
  expect(response.status()).toBe(200);
  const state = await stack();
  const zip = path.join(state.root, `${archiveId}.zip`);
  await writeFile(zip, await response.body());
  const names = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
    .trim()
    .split("\n");
  expect(names.sort()).toEqual(files.map((file) => file.name).sort());
  for (const file of files)
    expect(hash(execFileSync("unzip", ["-p", zip, file.name]))).toBe(
      hash(file.bytes),
    );
  return archiveId;
}

export async function mediaFixture(name = "preview.mp4", duration = 2) {
  const state = await stack();
  compose(state, [
    "exec",
    "-T",
    "worker",
    "ffmpeg",
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc2=size=640x360:rate=24:duration=${duration}`,
    "-threads",
    "1",
    "-c:v",
    "mpeg4",
    `/tmp/${name}`,
  ]);
  const worker = compose(state, ["ps", "-q", "worker"]).trim();
  const target = path.join(state.root, name);
  execFileSync("docker", ["cp", `${worker}:/tmp/${name}`, target]);
  return readFile(target);
}

export { compose, waitFor };
