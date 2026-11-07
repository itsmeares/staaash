import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import { beforeAll, expect, it } from "vite-plus/test";

import { getStoragePath } from "../storage";
import { createFilesService } from "./service";

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

const drive = async (storageLimitBytes: bigint | null = null) => {
  const id = randomUUID();
  await db.user.create({
    data: {
      id,
      email: `${id}@upload-groups.test`,
      storageId: id,
      passwordHash: "test-only",
      storageLimitBytes,
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: id, name: "Files", isFilesRoot: true },
  });
  await mkdir(getStoragePath(`files/${id}`), { recursive: true });
  return { id, rootId: root.id };
};

type Item = {
  name: string;
  text?: string;
  key?: string;
  conflictStrategy?: "fail" | "safeRename";
};

const upload = (
  { id, rootId }: { id: string; rootId: string },
  items: Item[],
  idempotencyKey = randomUUID(),
) =>
  service.uploadFiles({
    actorUserId: id,
    actorRole: "member",
    folderId: rootId,
    idempotencyKey,
    items: items.map((item) => ({
      clientKey: randomUUID(),
      originalName: item.name,
      conflictStrategy: item.conflictStrategy ?? "fail",
      idempotencyKey: item.key,
      file: new File([item.text ?? item.name], item.name, {
        type: "text/plain",
      }),
    })),
  });

const uploadMutations = (ownerUserId: string) =>
  db.storageMutation.findMany({
    where: { ownerUserId, kind: "upload_create" },
    include: { steps: true, entities: true },
  });

const leftInStaging = async (names: string[]) => {
  const staged = await readdir(getStoragePath("tmp")).catch(() => []);
  const contents = await Promise.all(
    staged
      .filter((entry) => entry.endsWith(".upload"))
      .map((entry) =>
        readFile(getStoragePath(`tmp/${entry}`), "utf8").catch(() => ""),
      ),
  );
  return contents.filter((text) => names.includes(text));
};

it("saves a request's new files as one journal mutation", async () => {
  const user = await drive();
  const names = ["a.txt", "b.txt", "c.txt"];

  const result = await upload(
    user,
    names.map((name) => ({ name })),
  );

  expect(result.uploadedFiles.map((file) => file.name)).toEqual(names);
  const mutations = await uploadMutations(user.id);
  expect(mutations).toHaveLength(1);
  expect(mutations[0]).toMatchObject({ status: "succeeded" });
  expect(mutations[0]!.steps).toHaveLength(3);
  for (const name of names) {
    await expect(
      readFile(getStoragePath(`files/${user.id}/${name}`), "utf8"),
    ).resolves.toBe(name);
  }
});

it("replays the request, or one of its files on its own", async () => {
  const user = await drive();
  const items = ["a.txt", "b.txt", "c.txt"].map((name) => ({
    name,
    key: randomUUID(),
  }));
  const first = await upload(user, items);

  const again = await upload(user, items);
  const lastAlone = await upload(user, [items[2]!]);

  expect(again.uploadedFiles.map((file) => file.id)).toEqual(
    first.uploadedFiles.map((file) => file.id),
  );
  expect(lastAlone.uploadedFiles.map((file) => file.id)).toEqual([
    first.uploadedFiles[2]!.id,
  ]);
  expect(await uploadMutations(user.id)).toHaveLength(1);
  await expect(
    upload(user, [{ ...items[1]!, text: "other bytes" }]),
  ).rejects.toMatchObject({ code: "STORAGE_IDEMPOTENCY_KEY_REUSED" });
});

it("handles the same name twice in one request like two requests", async () => {
  const user = await drive();

  const renamed = await upload(user, [
    { name: "a.txt", text: "first" },
    { name: "a.txt", text: "second", conflictStrategy: "safeRename" },
  ]);
  const refused = await upload(user, [
    { name: "b.txt" },
    { name: "b.txt", conflictStrategy: "fail" },
  ]);

  expect(renamed.uploadedFiles.map((file) => file.name)).toEqual([
    "a.txt",
    "a (1).txt",
  ]);
  expect(refused.uploadedFiles.map((file) => file.name)).toEqual(["b.txt"]);
  expect(refused.conflicts).toMatchObject([{ originalName: "b.txt" }]);
});

it("refuses the whole group over quota and keeps nothing staged", async () => {
  const user = await drive(10n);
  const names = ["quota-1.txt", "quota-2.txt"];

  await expect(
    upload(
      user,
      names.map((name) => ({ name, text: name })),
    ),
  ).rejects.toMatchObject({ code: "USER_STORAGE_QUOTA_EXCEEDED" });

  expect(await db.file.count({ where: { ownerUserId: user.id } })).toBe(0);
  expect(await leftInStaging(names)).toEqual([]);
});
