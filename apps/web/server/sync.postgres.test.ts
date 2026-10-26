import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { getPrisma, Prisma } from "@staaash/db/client";
import {
  currentStorageChangeCursor,
  pruneStorageChanges,
  readStorageChanges,
  readStorageSnapshotPage,
  StorageChangesExpiredError,
} from "@staaash/db/storage-changes";
import { beforeAll, expect, it } from "vite-plus/test";

import {
  approveDevice,
  exchangeDeviceCode,
  issueWebSessionCode,
  redeemWebSessionCode,
} from "./auth/device";
import { SESSION_COOKIE_NAME } from "./auth/session";
import { authService } from "./auth/service";
import { createFilesService } from "./files/service";
import { app } from "./http/app";
import { getStoragePath } from "./storage";

const db = getPrisma();
const service = createFilesService();

beforeAll(async () => {
  await db.instance.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      name: "Test drive",
      authSecret: "test-only",
      storageProtocolVersion: 2,
    },
    update: { storageProtocolVersion: 2 },
  });
});

const createOwner = async () => {
  const id = randomUUID();
  const user = await db.user.create({
    data: {
      id,
      email: `${id}@sync.test`,
      storageId: id,
      passwordHash: "test-only",
      preferences: { create: { onboardingCompletedAt: new Date() } },
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  return {
    user,
    root,
    actor: { actorUserId: id, actorRole: "member" as const },
  };
};

const placeFile = async (
  ownerUserId: string,
  folderId: string,
  storageKey: string,
  content: string,
) => {
  const bytes = Buffer.from(content);
  await writeFile(getStoragePath(storageKey), bytes);
  return db.file.create({
    data: {
      ownerUserId,
      folderId,
      originalName: storageKey.split("/").at(-1)!,
      storageKey,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
      contentChecksum: createHash("sha256").update(bytes).digest("hex"),
    },
  });
};

const changesFor = async (ownerUserId: string, after = 0n) =>
  (await readStorageChanges(db, { ownerUserId, after, limit: 100 })).changes;

it("logs one change per top-level item, with paths, and pages by cursor", async () => {
  const { user, root, actor } = await createOwner();
  const other = await createOwner();
  const start = await currentStorageChangeCursor(db);

  const docs = (
    await service.createFolder({ ...actor, parentId: root.id, name: "Docs" })
  ).folder;
  const inner = (
    await service.createFolder({ ...actor, parentId: docs.id, name: "Inner" })
  ).folder;
  await service.createFolder({
    ...other.actor,
    parentId: other.root.id,
    name: "Not mine",
  });
  const file = await placeFile(
    user.id,
    inner.id,
    `files/${user.id}/Docs/Inner/a.txt`,
    "hello",
  );

  await service.renameFolder({ ...actor, folderId: docs.id, name: "Papers" });
  await service.moveFile({
    ...actor,
    fileId: file.id,
    destinationFolderId: root.id,
  });
  await service.trashFolder({ ...actor, folderId: docs.id });
  await service.restoreFolder({ ...actor, folderId: docs.id });

  const changes = await changesFor(user.id, start);
  expect(
    changes.map(({ kind, itemType, path, previousPath }) => ({
      kind,
      itemType,
      path,
      previousPath,
    })),
  ).toEqual([
    { kind: "created", itemType: "folder", path: "Docs", previousPath: null },
    {
      kind: "created",
      itemType: "folder",
      path: "Docs/Inner",
      previousPath: null,
    },
    // The rename covers Inner and its file: no entries for them.
    { kind: "moved", itemType: "folder", path: "Papers", previousPath: "Docs" },
    {
      kind: "moved",
      itemType: "file",
      path: "a.txt",
      previousPath: "Papers/Inner/a.txt",
    },
    { kind: "trashed", itemType: "folder", path: "Papers", previousPath: null },
    {
      kind: "restored",
      itemType: "folder",
      path: "Papers",
      previousPath: null,
    },
  ]);
  expect(changes[3]).toMatchObject({
    parentId: root.id,
    previousParentId: inner.id,
    contentChecksum: file.contentChecksum,
    // One bump from the folder rename above it, one from the move.
    storageRevision: 2,
  });

  const first = await readStorageChanges(db, {
    ownerUserId: user.id,
    after: start,
    limit: 4,
  });
  expect(first.hasMore).toBe(true);
  const rest = await readStorageChanges(db, {
    ownerUserId: user.id,
    after: first.cursor,
    limit: 4,
  });
  expect(rest.hasMore).toBe(false);
  expect([...first.changes, ...rest.changes].map((c) => c.seq)).toEqual(
    changes.map((c) => c.seq),
  );

  const snapshot = await readStorageSnapshotPage(db, {
    ownerUserId: user.id,
    folderId: null,
    after: null,
    limit: 100,
  });
  expect(
    snapshot?.items.map(({ type, path }) => `${type}:${path}`).sort(),
  ).toEqual(["file:a.txt", "folder:Papers", "folder:Papers/Inner"]);
});

it("refuses a stale revision with the current item and bumps by one", async () => {
  const { user, root, actor } = await createOwner();
  const file = await placeFile(
    user.id,
    root.id,
    `files/${user.id}/notes.txt`,
    "v1",
  );

  await expect(
    service.renameFile({
      ...actor,
      fileId: file.id,
      name: "renamed.txt",
      ifRevision: 3,
    }),
  ).rejects.toMatchObject({
    status: 409,
    code: "REVISION_MISMATCH",
    details: {
      id: file.id,
      storageRevision: 0,
      name: "notes.txt",
      parentId: root.id,
      contentChecksum: file.contentChecksum,
      size: 2,
    },
  });

  const renamed = await service.renameFile({
    ...actor,
    fileId: file.id,
    name: "renamed.txt",
    ifRevision: 0,
  });
  expect(renamed.file?.storageRevision).toBe(1);
  await expect(
    service.trashFile({ ...actor, fileId: file.id, ifRevision: 0 }),
  ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
});

it("keeps mine: the file keeps its id and the old bytes go to the trash", async () => {
  const { user, root, actor } = await createOwner();
  const original = await placeFile(
    user.id,
    root.id,
    `files/${user.id}/plan.txt`,
    "server version",
  );
  const copy = await placeFile(
    user.id,
    root.id,
    `files/${user.id}/plan (conflict).txt`,
    "my version",
  );
  const before = await currentStorageChangeCursor(db);

  await expect(
    service.keepMine({
      ...actor,
      fileId: original.id,
      conflictCopyId: copy.id,
      ifRevision: 5,
    }),
  ).rejects.toMatchObject({ code: "REVISION_MISMATCH" });

  const result = await service.keepMine({
    ...actor,
    fileId: original.id,
    conflictCopyId: copy.id,
    ifRevision: 0,
    idempotencyKey: `keep-${randomUUID()}`,
  });
  expect(result.file).toMatchObject({
    id: original.id,
    name: "plan.txt",
    storageRevision: 1,
  });

  const kept = await db.file.findUniqueOrThrow({ where: { id: original.id } });
  expect(kept.storageKey).toBe(original.storageKey);
  expect(kept.contentChecksum).toBe(copy.contentChecksum);
  expect(await readFile(getStoragePath(kept.storageKey), "utf8")).toBe(
    "my version",
  );

  const trashed = await db.file.findUniqueOrThrow({ where: { id: copy.id } });
  expect(trashed).toMatchObject({
    originalName: "plan.txt",
    contentChecksum: original.contentChecksum,
  });
  expect(trashed.deletedAt).not.toBeNull();
  expect(trashed.trashEntryId).not.toBeNull();
  expect(await readFile(getStoragePath(trashed.storageKey), "utf8")).toBe(
    "server version",
  );

  const changes = await changesFor(user.id, before);
  expect(changes.map((c) => [c.kind, c.itemId])).toEqual(
    expect.arrayContaining([
      ["updated", original.id],
      ["trashed", copy.id],
    ]),
  );
  expect(changes).toHaveLength(2);
});

it("answers a retry of a finished change with the item as it is now", async () => {
  const { user, root, actor } = await createOwner();
  const original = await placeFile(
    user.id,
    root.id,
    `files/${user.id}/draft.txt`,
    "server",
  );
  const copy = await placeFile(
    user.id,
    root.id,
    `files/${user.id}/draft (conflict).txt`,
    "mine",
  );
  const keepKey = `keep-${randomUUID()}`;
  const keep = {
    ...actor,
    fileId: original.id,
    conflictCopyId: copy.id,
    ifRevision: 0,
    idempotencyKey: keepKey,
  };
  await service.keepMine(keep);
  // Worker recovery finishes the journal without saving the web reply.
  await db.storageMutation.update({
    where: { idempotencyKey: keepKey },
    data: { resultJson: Prisma.DbNull },
  });
  const cursor = await currentStorageChangeCursor(db);
  expect((await service.keepMine(keep)).file).toMatchObject({
    id: original.id,
    storageRevision: 1,
  });
  expect(await changesFor(user.id, cursor)).toEqual([]);

  const renameKey = `rename-${randomUUID()}`;
  const rename = {
    ...actor,
    fileId: original.id,
    name: "final.txt",
    idempotencyKey: renameKey,
  };
  await service.renameFile(rename);
  // The reply saved before the change still has the old revision.
  const stale = await db.storageMutation.findUniqueOrThrow({
    where: { idempotencyKey: renameKey },
  });
  const staleJson = stale.resultJson as { response: { file: object } };
  await db.storageMutation.update({
    where: { id: stale.id },
    data: {
      resultJson: {
        response: { file: { ...staleJson.response.file, storageRevision: 1 } },
      },
    },
  });
  expect((await service.renameFile(rename)).file).toMatchObject({
    name: "final.txt",
    storageRevision: 2,
  });
});

it("logs an update when a file is replaced by the same bytes", async () => {
  const { user, root, actor } = await createOwner();
  const upload = (clientModifiedAt: Date) =>
    service.uploadFiles({
      ...actor,
      folderId: root.id,
      idempotencyKey: randomUUID(),
      items: [
        {
          clientKey: randomUUID(),
          originalName: "same.txt",
          conflictStrategy: "replace",
          clientModifiedAt,
          file: new File(["same bytes"], "same.txt", { type: "text/plain" }),
        },
      ],
    });
  const [created] = (await upload(new Date("2020-01-02T03:04:05Z")))
    .uploadedFiles;
  const cursor = await currentStorageChangeCursor(db);
  const [replaced] = (await upload(new Date("2024-08-09T10:11:12Z")))
    .uploadedFiles;
  expect(replaced).toMatchObject({ id: created!.id, storageRevision: 1 });
  expect(await changesFor(user.id, cursor)).toMatchObject([
    {
      kind: "updated",
      itemId: created!.id,
      storageRevision: 1,
      clientModifiedAt: new Date("2024-08-09T10:11:12Z"),
    },
  ]);
});

it("answers 410 once the cursor is older than the kept log", async () => {
  const { user } = await createOwner();
  await db.storageChange.updateMany({
    data: { createdAt: new Date(Date.now() - 100 * 86_400_000) },
  });
  const kept = await db.storageChange.create({
    data: {
      ownerUserId: user.id,
      kind: "created",
      itemType: "folder",
      itemId: randomUUID(),
      path: "kept",
      name: "kept",
      storageRevision: 0,
    },
  });
  await pruneStorageChanges(db);
  await expect(
    readStorageChanges(db, { ownerUserId: user.id, after: 0n, limit: 10 }),
  ).rejects.toBeInstanceOf(StorageChangesExpiredError);
  const fromEdge = await readStorageChanges(db, {
    ownerUserId: user.id,
    after: kept.seq - 1n,
    limit: 10,
  });
  expect(fromEdge.changes.map((c) => c.path)).toEqual(["kept"]);
});

it("answers a repeated upload completion with the finished file", async () => {
  const { user, root } = await createOwner();
  const { sessionToken } = await authService.createSession(user.id, {});
  const call = (
    path: string,
    method: string,
    body?: BodyInit,
    type = "application/json",
    extra = {},
  ) =>
    app.request(`http://localhost:3000${path}`, {
      method,
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        host: "localhost:3000",
        origin: "http://localhost:3000",
        "content-type": type,
        ...extra,
      },
      body,
    });
  const bytes = Buffer.from("finished once");
  const expectedChecksum = createHash("sha256").update(bytes).digest("hex");
  const created = await call(
    "/api/uploads/sessions",
    "POST",
    JSON.stringify({
      folderId: root.id,
      originalName: "once.txt",
      mimeType: "text/plain",
      totalSizeBytes: bytes.length,
    }),
  );
  expect(created.status, await created.clone().text()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const chunk = await call(
    `/api/uploads/sessions/${id}`,
    "PATCH",
    bytes,
    "application/octet-stream",
    { "content-range": `bytes 0-${bytes.length - 1}/${bytes.length}` },
  );
  expect(chunk.status, await chunk.clone().text()).toBe(200);
  const complete = (checksum: string) =>
    call(
      `/api/uploads/sessions/${id}/complete`,
      "POST",
      JSON.stringify({ expectedChecksum: checksum }),
    );
  const first = await complete(expectedChecksum);
  expect(first.status, await first.clone().text()).toBe(201);
  const file = (await first.json()) as { id: string };

  const again = await complete(expectedChecksum);
  expect(again.status, await again.clone().text()).toBe(201);
  expect(await again.json()).toMatchObject({ id: file.id });
  expect((await complete("0".repeat(64))).status).toBe(400);
  expect(
    await db.file.count({ where: { ownerUserId: user.id, deletedAt: null } }),
  ).toBe(1);
});

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
};

it("signs a device in with PKCE, tags its changes, and revokes its window with it", async () => {
  const { user, root } = await createOwner();
  const { verifier, challenge } = pkce();
  const redirectUri = "http://127.0.0.1:53682/callback";

  await expect(
    approveDevice({
      userId: user.id,
      redirectUri: "https://evil.example/cb",
      codeChallenge: challenge,
      deviceName: "Laptop",
    }),
  ).rejects.toMatchObject({ code: "DEVICE_REQUEST_INVALID" });

  const { redirectUrl } = await approveDevice({
    userId: user.id,
    redirectUri,
    codeChallenge: challenge,
    deviceName: "Laptop",
  });
  const code = new URL(redirectUrl).searchParams.get("code")!;
  await expect(
    exchangeDeviceCode(
      { code, codeVerifier: pkce().verifier, redirectUri },
      {},
    ),
  ).rejects.toMatchObject({ code: "DEVICE_CODE_INVALID" });
  // A wrong verifier still uses the code up.
  await expect(
    exchangeDeviceCode({ code, codeVerifier: verifier, redirectUri }, {}),
  ).rejects.toMatchObject({ code: "DEVICE_CODE_INVALID" });

  const again = pkce();
  const second = await approveDevice({
    userId: user.id,
    redirectUri,
    codeChallenge: again.challenge,
    deviceName: "Laptop",
  });
  const device = await exchangeDeviceCode(
    {
      code: new URL(second.redirectUrl).searchParams.get("code")!,
      codeVerifier: again.verifier,
      redirectUri,
    },
    {},
  );
  expect(device.session.deviceName).toBe("Laptop");
  const bearer = { authorization: `Bearer ${device.sessionToken}` };
  const cursor = await currentStorageChangeCursor(db);

  // A cross-site Origin does not matter for a header token.
  const created = await app.request("/api/files/folders", {
    method: "POST",
    headers: {
      ...bearer,
      origin: "https://elsewhere.example",
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ parentId: root.id, name: "From laptop" }),
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const feed = await app.request(`/api/sync/changes?after=${cursor}`, {
    headers: bearer,
  });
  const body = (await feed.json()) as {
    error?: string;
    changes: Array<{ path: string; originDeviceId: string | null }>;
  };
  expect(feed.status, body.error).toBe(200);
  expect(body.changes.at(-1)).toMatchObject({
    path: "From laptop",
    originDeviceId: device.session.id,
  });

  const admin = await app.request("/api/admin/health", { headers: bearer });
  expect(admin.status).toBe(403);

  const statusOf = async (path: string) =>
    (await app.request(path, { headers: bearer })).status;
  expect(await statusOf("/api/sync/changes?after=9223372036854775807")).toBe(
    200,
  );
  expect(await statusOf("/api/sync/changes?after=9223372036854775808")).toBe(
    400,
  );
  expect(await statusOf("/api/sync/snapshot?cursor=folder:a%00b")).toBe(400);

  const { code: webCode } = await issueWebSessionCode({
    id: device.session.id,
    userId: user.id,
  });
  const window = await redeemWebSessionCode(webCode, {});
  await expect(redeemWebSessionCode(webCode, {})).rejects.toMatchObject({
    code: "DEVICE_CODE_INVALID",
  });
  expect(await authService.getSession(window.sessionToken)).not.toBeNull();

  const events = await app.request("/api/sync/events", { headers: bearer });
  const stream = events.body!.getReader();
  expect((await stream.read()).done).toBe(false);

  await authService.revokeOwnSessions(
    user.id,
    { id: "another-browser", deviceSessionId: null },
    device.session.id,
  );
  // The next change closes the open stream instead of reaching the device.
  await service.createFolder({
    actorUserId: user.id,
    actorRole: "member",
    parentId: root.id,
    name: "After sign-out",
  });
  expect(await stream.read()).toMatchObject({ done: true });
  expect(await authService.getSession(device.sessionToken)).toBeNull();
  expect(await authService.getSession(window.sessionToken)).toBeNull();
  const after = await app.request(`/api/sync/changes?after=${cursor}`, {
    headers: bearer,
  });
  expect(after.status).toBe(401);
});
