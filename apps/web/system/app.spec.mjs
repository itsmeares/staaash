import { test, expect } from "@playwright/test";
import {
  createStack,
  startDatabase,
  startApp,
  destroyStack,
} from "../../../scripts/ci/stack.mjs";
import {
  account,
  anonymous,
  archive,
  auditTotals,
  downloaded,
  hash,
  json,
  mediaFixture,
  reconcile,
  signedIn,
  stack,
  unique,
  upload,
} from "./support.mjs";

test("a fresh installation creates its owner once and accepts real file uploads", async () => {
  const current = await stack();
  const fresh = await createStack(current.image);
  let owner;
  try {
    await startDatabase(fresh);
    await startApp(fresh, true, false);
    owner = await anonymous(fresh.origin);
    const setup = {
      instanceName: "Fresh test drive",
      email: "fresh@staaash.test",
      displayName: "Fresh owner",
      password: "test-only-owner-password",
    };
    await json(owner, "/api/auth/setup", setup, 201);
    await json(owner, "/api/user/preferences", {
      theme: "dark",
      timeZone: "UTC",
    });
    expect(
      (await owner.post("/api/auth/setup", { data: setup })).status(),
    ).toBe(409);
    await startApp(fresh, false);
    const bytes = Buffer.from("first original");
    const file = await upload(owner, "First.txt", bytes);
    await downloaded(owner, file.id, bytes);
  } finally {
    await owner?.dispose();
    await destroyStack(fresh);
  }
});

test("file mutations preserve bytes, identity and private access", async () => {
  const owner = await signedIn();
  const member = await account(owner);
  const foreign = await account(owner);
  try {
    const bytes = Buffer.from("original bytes, including Unicode: café");
    const name = `${unique("original")}.txt`;
    const file = await upload(member.api, name, bytes);
    await downloaded(member.api, file.id, bytes);
    const denied = await foreign.api.get(
      `/api/files/files/${file.id}/download`,
    );
    expect([403, 404]).toContain(denied.status());
    const ownerDenied = await owner.get(`/api/files/files/${file.id}/download`);
    expect([403, 404]).toContain(ownerDenied.status());
    const kept = await upload(
      member.api,
      name,
      Buffer.from("kept separately"),
      { strategy: "safeRename" },
    );
    expect(kept.id).not.toBe(file.id);
    const replacement = Buffer.from("replacement bytes");
    const replaced = await upload(member.api, name, replacement, {
      strategy: "replace",
    });
    expect(replaced.id).toBe(file.id);
    await json(member.api, `/api/files/files/${file.id}/rename`, {
      name: "Renamed.txt",
    });
    const { folder } = await json(
      member.api,
      "/api/files/folders",
      { name: unique("destination") },
      201,
    );
    await json(member.api, `/api/files/files/${file.id}/move`, {
      destinationFolderId: folder.id,
    });
    await json(member.api, `/api/files/folders/${folder.id}/trash`, {});
    expect(
      (await member.api.get(`/api/files/files/${file.id}/download`)).status(),
    ).not.toBe(200);
    await json(member.api, `/api/files/folders/${folder.id}/restore`, {});
    await downloaded(member.api, file.id, replacement);
    await archive(member.api, [
      { id: file.id, name: "Renamed.txt", bytes: replacement },
      { id: kept.id, name: kept.name, bytes: Buffer.from("kept separately") },
    ]);
    await auditTotals();
  } finally {
    await Promise.all([
      owner.dispose(),
      member.api.dispose(),
      foreign.api.dispose(),
    ]);
  }
});

test("resumable uploads reject incomplete and corrupt bytes, then allow a clean retry", async () => {
  const owner = await signedIn();
  const member = await account(owner);
  try {
    const bytes = Buffer.from("resumable original");
    const session = await json(
      member.api,
      "/api/uploads/sessions",
      {
        originalName: "resume.txt",
        mimeType: "text/plain",
        totalSizeBytes: bytes.length,
      },
      201,
    );
    expect(
      (
        await member.api.post(`/api/uploads/sessions/${session.id}/complete`, {
          data: { expectedChecksum: hash(bytes) },
        })
      ).status(),
    ).toBe(400);
    const patch = await member.api.patch(
      `/api/uploads/sessions/${session.id}`,
      {
        headers: {
          "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
        },
        data: bytes,
      },
    );
    expect(patch.ok(), await patch.text()).toBe(true);
    const repeated = await member.api.patch(
      `/api/uploads/sessions/${session.id}`,
      {
        headers: {
          "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
        },
        data: bytes,
      },
    );
    expect(repeated.ok()).toBe(true);
    const status = await (
      await member.api.get(`/api/uploads/sessions/${session.id}`)
    ).json();
    expect(status.receivedBytes).toBe(bytes.length);
    const result = await json(
      member.api,
      `/api/uploads/sessions/${session.id}/complete`,
      { expectedChecksum: hash(bytes) },
      201,
    );
    await downloaded(member.api, result.id, bytes);
    const corrupt = await json(
      member.api,
      "/api/uploads/sessions",
      {
        originalName: "corrupt.txt",
        mimeType: "text/plain",
        totalSizeBytes: bytes.length,
      },
      201,
    );
    await member.api.patch(`/api/uploads/sessions/${corrupt.id}`, {
      headers: {
        "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}`,
      },
      data: bytes,
    });
    const mismatch = await member.api.post(
      `/api/uploads/sessions/${corrupt.id}/complete`,
      { data: { expectedChecksum: "0".repeat(64) } },
    );
    expect(mismatch.status()).toBe(400);
    expect((await mismatch.json()).code).toBe("CHECKSUM_MISMATCH");
    const cancelled = await json(
      member.api,
      "/api/uploads/sessions",
      {
        originalName: "cancelled.txt",
        mimeType: "text/plain",
        totalSizeBytes: 5,
      },
      201,
    );
    expect(
      (
        await member.api.delete(`/api/uploads/sessions/${cancelled.id}`)
      ).status(),
    ).toBe(204);
    expect(
      (await member.api.get(`/api/uploads/sessions/${cancelled.id}`)).status(),
    ).toBe(404);
    await upload(member.api, "corrupt.txt", bytes);
    await auditTotals();
  } finally {
    await Promise.all([owner.dispose(), member.api.dispose()]);
  }
});

test("quota refusals leave no published file and do not block the next upload", async () => {
  const owner = await signedIn();
  const member = await account(owner, "8");
  try {
    const response = await member.api.post("/api/uploads/sessions", {
      data: {
        originalName: "too-big",
        mimeType: "text/plain",
        totalSizeBytes: 9,
      },
    });
    expect(response.status()).toBe(413);
    expect((await response.json()).code).toBe("USER_STORAGE_QUOTA_EXCEEDED");
    const file = await upload(member.api, "fits.txt", Buffer.from("12345678"));
    await downloaded(member.api, file.id, Buffer.from("12345678"));
    await auditTotals();
  } finally {
    await Promise.all([owner.dispose(), member.api.dispose()]);
  }
});

test("public links enforce password, download policy, expiry and revoke", async () => {
  const owner = await signedIn();
  const member = await account(owner);
  const visitor = await anonymous();
  try {
    const bytes = Buffer.from("shared original");
    const file = await upload(member.api, "shared.txt", bytes);
    const { share } = await json(
      member.api,
      "/api/shares",
      {
        targetType: "file",
        fileId: file.id,
        password: "test-share-password",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      },
      201,
    );
    const route = new URL(share.shareUrl).pathname;
    expect((await visitor.get(`${route}/download`)).status()).not.toBe(200);
    expect(
      (
        await visitor.post(`${route}/unlock`, { data: { password: "wrong" } })
      ).status(),
    ).not.toBe(200);
    expect(
      (
        await visitor.post(`${route}/unlock`, {
          data: { password: "test-share-password" },
        })
      ).ok(),
    ).toBe(true);
    const download = await visitor.get(`${route}/download`);
    expect(download.status()).toBe(200);
    expect(hash(await download.body())).toBe(hash(bytes));
    await json(member.api, `/api/shares/${share.id}/update`, {
      downloadDisabled: true,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    expect((await visitor.get(`${route}/download`)).status()).toBe(403);
    await json(member.api, `/api/shares/${share.id}/update`, {
      downloadDisabled: false,
      expiresAt: new Date(Date.now() + 2000).toISOString(),
    });
    await json(visitor, `${route}/unlock`, { password: "test-share-password" });
    expect((await visitor.get(`${route}/download`)).status()).toBe(200);
    await expect
      .poll(async () => (await visitor.get(`${route}/download`)).status(), {
        timeout: 10_000,
      })
      .not.toBe(200);
    await json(member.api, `/api/shares/${share.id}/update`, {
      downloadDisabled: false,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    await json(member.api, `/api/shares/${share.id}/revoke`, {});
    expect((await visitor.get(`${route}/download`)).status()).not.toBe(200);
  } finally {
    await Promise.all([
      owner.dispose(),
      member.api.dispose(),
      visitor.dispose(),
    ]);
  }
});

test("real media generation and restore reconciliation finish successfully", async () => {
  const owner = await signedIn();
  try {
    const bytes = await mediaFixture();
    const file = await upload(owner, `${unique("video")}.mp4`, bytes, {
      mimeType: "video/mp4",
    });
    await json(owner, `/api/files/files/${file.id}/derivative`, {});
    await expect
      .poll(
        async () =>
          (
            await (
              await owner.get(`/api/files/files/${file.id}/derivative`)
            ).json()
          ).status,
        { timeout: 90_000 },
      )
      .toBe("ready");
    await expect
      .poll(
        async () =>
          (await owner.get(`/api/files/files/${file.id}/thumbnail`)).status(),
        { timeout: 60_000 },
      )
      .toBe(200);
    const thumbnail = await (
      await owner.get(`/api/files/files/${file.id}/thumbnail`)
    ).body();
    expect(thumbnail.subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    await downloaded(owner, file.id, bytes);
    await reconcile(owner);
    await auditTotals();
  } finally {
    await owner.dispose();
  }
});
