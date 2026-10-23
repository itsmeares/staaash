import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
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

  const { code: webCode } = await issueWebSessionCode({
    id: device.session.id,
    userId: user.id,
  });
  const window = await redeemWebSessionCode(webCode, {});
  await expect(redeemWebSessionCode(webCode, {})).rejects.toMatchObject({
    code: "DEVICE_CODE_INVALID",
  });
  expect(await authService.getSession(window.sessionToken)).not.toBeNull();

  await authService.revokeOwnSessions(
    user.id,
    { id: "another-browser", deviceSessionId: null },
    device.session.id,
  );
  expect(await authService.getSession(device.sessionToken)).toBeNull();
  expect(await authService.getSession(window.sessionToken)).toBeNull();
  const after = await app.request(`/api/sync/changes?after=${cursor}`, {
    headers: bearer,
  });
  expect(after.status).toBe(401);
});
