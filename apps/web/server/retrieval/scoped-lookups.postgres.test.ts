import { getRetrievalPage } from "./page";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { prismaFilesRepository } from "@/server/files/repository";
import { createSharingService } from "@/server/sharing/service";

it("keeps sparse retrieval and owned-share results complete without loading unrelated metadata", async () => {
  const db = getPrisma();
  const date = new Date("2026-01-01T00:00:00Z");
  const user = () =>
    db.user.create({
      data: {
        email: `${randomUUID()}@lookup.test`,
        storageId: randomUUID(),
        passwordHash: "test-only",
      },
    });
  const owner = await user();
  const other = await user();
  const root = await db.folder.create({
    data: { ownerUserId: owner.id, name: "Files", isFilesRoot: true },
  });
  const parent = await db.folder.create({
    data: { ownerUserId: owner.id, parentId: root.id, name: "Projects" },
  });
  const deep = await db.folder.create({
    data: { ownerUserId: owner.id, parentId: parent.id, name: "Deep" },
  });
  const removed = await db.folder.create({
    data: {
      ownerUserId: owner.id,
      parentId: root.id,
      name: "Trash",
      deletedAt: date,
    },
  });
  const file = (name: string, extra = {}) =>
    db.file.create({
      data: {
        ownerUserId: owner.id,
        folderId: deep.id,
        originalName: name,
        storageKey: randomUUID(),
        mimeType: "text/plain",
        sizeBytes: 32,
        createdAt: date,
        updatedAt: date,
        ...extra,
      },
    });
  const alpha = await file("Álpha.txt");
  const beta = await file("beta.txt");
  const missing = await file("missing.txt", { storageStatus: "missing" });
  const deleted = await file("deleted.txt", { deletedAt: date });
  const foreign = await file("foreign.txt", { ownerUserId: other.id });
  const underDeleted = await file("under-deleted.txt", {
    folderId: removed.id,
  });
  await file("unrelated.txt");
  for (const item of [alpha, beta, missing, deleted, foreign, underDeleted]) {
    await db.favoriteFile.create({
      data: {
        userId: owner.id,
        fileId: item.id,
        createdAt: date,
        quickAccessPinnedAt: item.id === beta.id ? date : null,
      },
    });
    await db.recentFile.create({
      data: { userId: owner.id, fileId: item.id, lastInteractedAt: date },
    });
  }
  for (const item of [root, deep, removed]) {
    await db.favoriteFolder.create({
      data: { userId: owner.id, folderId: item.id, createdAt: date },
    });
    await db.recentFolder.create({
      data: { userId: owner.id, folderId: item.id, lastInteractedAt: date },
    });
  }
  const shares = await Promise.all(
    [alpha, missing, deleted, foreign].map((item) =>
      db.shareLink.create({
        data: {
          createdByUserId: owner.id,
          targetType: "file",
          fileId: item.id,
          tokenLookupKey: randomUUID(),
          tokenHash: randomUUID(),
          expiresAt: new Date("2027-01-01"),
          createdAt: date,
          updatedAt: date,
        },
      }),
    ),
  );
  const folderShare = await db.shareLink.create({
    data: {
      createdByUserId: owner.id,
      targetType: "folder",
      folderId: deep.id,
      tokenLookupKey: randomUUID(),
      tokenHash: randomUUID(),
      expiresAt: new Date("2027-01-01"),
    },
  });
  const fileReads = vi
    .spyOn(prismaFilesRepository, "listFilesByOwner")
    .mockRejectedValue(new Error("Unrelated owner files"));
  const folderReads = vi
    .spyOn(prismaFilesRepository, "listFoldersByOwner")
    .mockRejectedValue(new Error("Unrelated owner folders"));
  try {
    const favorites = (await getRetrievalPage(owner.id, "favorites")).items;
    expect(favorites.map((item) => [item.name, item.pathLabel])).toEqual([
      [underDeleted.originalName, "Files / under-deleted.txt"],
      [missing.originalName, "Files / Projects / Deep / missing.txt"],
      [deep.name, "Files / Projects / Deep"],
      [beta.originalName, "Files / Projects / Deep / beta.txt"],
      [alpha.originalName, "Files / Projects / Deep / Álpha.txt"],
    ]);
    expect(
      favorites.find((item) => item.id === beta.id)?.quickAccessPinnedAt,
    ).toEqual(date);
    const recents = (await getRetrievalPage(owner.id, "recent")).items;
    // Recent keeps trashed items, so it can say they were trashed.
    expect(recents.map((item) => [item.name, item.pathLabel])).toEqual([
      [deep.name, "Files / Projects / Deep"],
      [alpha.originalName, "Files / Projects / Deep / Álpha.txt"],
      [beta.originalName, "Files / Projects / Deep / beta.txt"],
      [deleted.originalName, "Files / Projects / Deep / deleted.txt"],
      [missing.originalName, "Files / Projects / Deep / missing.txt"],
      [removed.name, "Files / Trash"],
      [underDeleted.originalName, "Files / Trash / under-deleted.txt"],
    ]);
    expect(recents.every((item) => item.isFavorite)).toBe(true);
    const sharing = createSharingService({
      now: () => new Date("2026-10-17T00:00:00Z"),
    });
    const actor = { actorUserId: owner.id, actorRole: "member" as const };
    const summaries = await sharing.listOwnedShares(actor);
    expect(new Set(summaries.active.map((share) => share.id))).toEqual(
      new Set([shares[0].id, shares[1].id, folderShare.id]),
    );
    expect(new Set(summaries.inactive.map((share) => share.id))).toEqual(
      new Set([shares[2].id, shares[3].id]),
    );
    expect(
      summaries.active.find((share) => share.fileId === alpha.id)?.target
        .pathLabel,
    ).toBe("Files / Projects / Deep / Álpha.txt");
    expect(
      summaries.inactive.find((share) => share.fileId === foreign.id)?.target
        .name,
    ).toBe("Unavailable file");
    const lookup = await sharing.getFilesShareLookup({
      ...actor,
      currentFolderId: deep.id,
      childFolderIds: [],
      fileIds: [alpha.id],
    });
    expect(lookup.currentFolderShare?.id).toBe(folderShare.id);
    expect(Object.keys(lookup.sharesByFileId)).toEqual([alpha.id]);
    expect(Object.keys(lookup.sharesByFolderId)).toEqual([deep.id]);
    const unrelatedIds = Array.from(
      { length: 70_000 },
      (_, index) => `unrelated-${index}`,
    );
    expect(
      (
        await prismaFilesRepository.listFilesByIds(owner.id, [
          ...unrelatedIds,
          foreign.id,
          alpha.id,
        ])
      ).map((file) => file.id),
    ).toEqual([alpha.id]);
    const largeLookup = await sharing.getFilesShareLookup({
      ...actor,
      currentFolderId: deep.id,
      childFolderIds: [...unrelatedIds, deep.id],
      fileIds: [...unrelatedIds, foreign.id, alpha.id],
    });
    expect(new Set(Object.keys(largeLookup.sharesByFileId))).toEqual(
      new Set([alpha.id, foreign.id]),
    );
    expect(largeLookup.sharesByFileId[foreign.id].target.name).toBe(
      "Unavailable file",
    );
    expect(Object.keys(largeLookup.sharesByFolderId)).toEqual([deep.id]);
    const mutation = await db.storageMutation.create({
      data: {
        ownerUserId: owner.id,
        kind: "move",
        status: "recovery_required",
        intentJson: {},
        entities: {
          create: {
            entityType: "file",
            entityId: alpha.id,
            preRevision: 0,
            postRevision: 1,
          },
        },
      },
    });
    expect(
      (await getRetrievalPage(owner.id, "recent")).items.find(
        (item) => item.id === alpha.id,
      )?.storageMutation?.id,
    ).toBe(mutation.id);
    await db.storageMutation.update({
      where: { id: mutation.id },
      data: { status: "aborted" },
    });
    await db.folder.update({
      where: { id: deep.id },
      data: { name: "Renamed" },
    });
    expect(
      (await getRetrievalPage(owner.id, "favorites")).items.find(
        (item) => item.id === alpha.id,
      )?.pathLabel,
    ).toBe("Files / Projects / Renamed / Álpha.txt");
    await db.file.update({
      where: { id: alpha.id },
      data: { folderId: root.id },
    });
    expect(
      (await sharing.listOwnedShares(actor)).active.find(
        (share) => share.fileId === alpha.id,
      )?.target.pathLabel,
    ).toBe("Files / Álpha.txt");
    await db.favoriteFile.deleteMany({ where: { userId: owner.id } });
    await db.favoriteFolder.deleteMany({ where: { userId: owner.id } });
    await db.recentFile.deleteMany({ where: { userId: owner.id } });
    await db.recentFolder.deleteMany({ where: { userId: owner.id } });
    expect((await getRetrievalPage(owner.id, "favorites")).items).toEqual([]);
    expect((await getRetrievalPage(owner.id, "recent")).items).toEqual([]);
    expect(fileReads).not.toHaveBeenCalled();
    expect(folderReads).not.toHaveBeenCalled();
  } finally {
    fileReads.mockRestore();
    folderReads.mockRestore();
  }
});
