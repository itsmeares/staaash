import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { createPrismaFilesRepository } from "@/server/files/repository";
import { createSharingService } from "./service";
import { createSharedFolderArchive } from "./archive";

it("serves complete scoped shares and archives, and fails closed across access changes", async () => {
  const db = getPrisma();
  const owner = await db.user.create({
    data: {
      email: `${randomUUID()}@public.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const shared = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Shared", parentId: root.id },
  });
  const deep = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Deep", parentId: shared.id },
  });
  const empty = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Empty", parentId: deep.id },
  });
  const privateFolder = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Private", parentId: root.id },
  });
  const bytes = Buffer.from("public fake bytes");
  const storageKey = `files/${owner.storageId}/Shared/Deep/target.txt`;
  const file = await db.file.create({
    data: {
      ownerUserId: owner.id,
      folderId: deep.id,
      originalName: "target.txt",
      storageKey,
      mimeType: "text/plain",
      sizeBytes: bytes.length,
    },
  });
  const filePath = path.join(process.env.UPLOAD_LOCATION!, storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
  const repository = createPrismaFilesRepository();
  const service = createSharingService({ filesRepo: repository });
  const created = await service.createOrReissueShare({
    actorUserId: owner.id,
    actorRole: "member",
    targetType: "folder",
    folderId: shared.id,
  });
  vi.spyOn(repository, "listFoldersByOwner").mockRejectedValue(
    new Error("Unrelated folders"),
  );
  vi.spyOn(repository, "listFilesByOwner").mockRejectedValue(
    new Error("Unrelated files"),
  );
  const input = { token: created.token, fileId: file.id };
  const listing = await service.resolvePublicShare({
    token: created.token,
    requestedFolderId: deep.id,
  });
  expect(listing).toMatchObject({
    kind: "folder",
    listing: {
      childFolders: [expect.objectContaining({ id: empty.id })],
      files: [expect.objectContaining({ id: file.id })],
    },
  });
  expect(await service.getSharedNestedFileContent(input)).toMatchObject({
    file: { id: file.id },
    downloadDisabled: false,
    hasPassword: false,
  });
  const other = await db.user.create({
    data: {
      email: `${randomUUID()}@public.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const foreignKey = `files/${other.storageId}/foreign.txt`;
  const foreign = await db.file.create({
    data: {
      ownerUserId: other.id,
      folderId: deep.id,
      originalName: "foreign.txt",
      storageKey: foreignKey,
      mimeType: "text/plain",
      sizeBytes: 1,
    },
  });
  const foreignPath = path.join(process.env.UPLOAD_LOCATION!, foreignKey);
  await mkdir(path.dirname(foreignPath), { recursive: true });
  await writeFile(foreignPath, "f");
  await expect(
    service.getSharedNestedFileContent({
      token: created.token,
      fileId: foreign.id,
    }),
  ).rejects.toMatchObject({ code: "SHARE_ACCESS_DENIED" });
  await expect(
    service.getSharedNestedFileDownload({
      token: created.token,
      fileId: foreign.id,
    }),
  ).rejects.toMatchObject({ code: "SHARE_ACCESS_DENIED" });
  const archive = await service.createFolderArchive({ token: created.token });
  const zip = Buffer.concat(await archive.stream.toArray());
  for (const name of [
    "Shared/",
    "Shared/Deep/",
    "Shared/Deep/Empty/",
    "Shared/Deep/target.txt",
  ])
    expect(zip.includes(Buffer.from(name))).toBe(true);
  expect(zip.includes(Buffer.from("Private"))).toBe(false);
  expect(zip.includes(Buffer.from("foreign.txt"))).toBe(false);
  await db.shareLink.update({
    where: { id: created.share.id },
    data: { downloadDisabled: true },
  });
  expect(await service.getSharedNestedFileContent(input)).toMatchObject({
    downloadDisabled: true,
  });
  await expect(
    service.getSharedNestedFileDownload(input),
  ).rejects.toMatchObject({ code: "SHARE_DOWNLOAD_DISABLED" });
  await expect(
    service.createFolderArchive({ token: created.token }),
  ).rejects.toMatchObject({ code: "SHARE_DOWNLOAD_DISABLED" });
  await db.shareLink.update({
    where: { id: created.share.id },
    data: { downloadDisabled: false },
  });
  const mutation = await db.storageMutation.create({
    data: {
      ownerUserId: owner.id,
      kind: "move",
      status: "recovery_required",
      intentJson: {},
      entities: {
        create: {
          entityType: "file",
          entityId: file.id,
          preRevision: 0,
          postRevision: 1,
        },
      },
    },
  });
  await expect(
    service.getSharedNestedFileDownload(input),
  ).rejects.toMatchObject({
    code: "STORAGE_RECOVERY_REQUIRED",
    mutationId: mutation.id,
  });
  await expect(
    service.createFolderArchive({ token: created.token }),
  ).rejects.toMatchObject({ code: "STORAGE_RECOVERY_REQUIRED" });
  const storedFile = await repository.findFileById(file.id);
  const sharedFolder = await repository.findFolderById(shared.id);
  expect(storedFile).not.toBeNull();
  expect(sharedFolder).not.toBeNull();
  await expect(
    createSharedFolderArchive({
      rootFolder: sharedFolder!,
      folders: [sharedFolder!],
      files: [
        ...Array.from({ length: 70_000 }, (_, index) => ({
          ...storedFile!,
          id: `unrelated-${index}`,
        })),
        storedFile!,
      ],
    }),
  ).rejects.toMatchObject({
    code: "STORAGE_RECOVERY_REQUIRED",
    mutationId: mutation.id,
  });
  await db.storageMutation.update({
    where: { id: mutation.id },
    data: { status: "aborted" },
  });
  await db.file.update({
    where: { id: file.id },
    data: { folderId: privateFolder.id },
  });
  await expect(service.getSharedNestedFileContent(input)).rejects.toMatchObject(
    { code: "SHARE_ACCESS_DENIED" },
  );
  await db.file.update({ where: { id: file.id }, data: { folderId: deep.id } });
  await db.folder.update({
    where: { id: deep.id },
    data: { deletedAt: new Date() },
  });
  await expect(service.getSharedNestedFileContent(input)).rejects.toMatchObject(
    { code: "SHARE_ACCESS_DENIED" },
  );
  await expect(
    service.resolvePublicShare({
      token: created.token,
      requestedFolderId: empty.id,
    }),
  ).rejects.toMatchObject({ code: "SHARE_ACCESS_DENIED" });
  await db.shareLink.update({
    where: { id: created.share.id },
    data: { revokedAt: new Date() },
  });
  await expect(service.getSharedNestedFileContent(input)).rejects.toMatchObject(
    { code: "SHARE_INVALID" },
  );
});
