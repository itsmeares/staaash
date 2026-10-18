import { randomUUID } from "node:crypto";
import { expect, it } from "vite-plus/test";
import { getPrisma } from "@staaash/db/client";
import { getListWindow } from "./list-window";
import { getRetrievalPage } from "./retrieval/page";
import { getSearchPage } from "./retrieval/search-page";
import {
  getActivityPage,
  resolveActivitySelection,
} from "./retrieval/activity-page";
import { createFilesService } from "./files/service";
import { getViewerWindow } from "./files/viewer-window";
import {
  compareSearchResults,
  getSearchMatchKind,
  normalizeSearchText,
  prepareSearchCandidate,
} from "./search";

const db = getPrisma();
async function fixture() {
  const user = await db.user.create({
    data: {
      email: `${randomUUID()}@list.test`,
      storageId: randomUUID(),
      passwordHash: "test-only",
    },
  });
  const root = await db.folder.create({
    data: { ownerUserId: user.id, name: "Files", isFilesRoot: true },
  });
  const folder = await db.folder.create({
    data: { ownerUserId: user.id, name: "Café photos", parentId: root.id },
  });
  const names = [
    "File 10.txt",
    "File 2.txt",
    "File 1.txt",
    "Résumé.pdf",
    "Cafe.txt",
    "İstanbul.txt",
    "Łódź.txt",
    "Ｆｕｌｌ.txt",
    "ΟΣ.txt",
    "padded.txt \t",
  ];
  await db.file.createMany({
    data: Array.from({ length: 233 }, (_, n) => ({
      id: `${user.id}-${n}`,
      ownerUserId: user.id,
      folderId: folder.id,
      originalName: names[n] ?? `File ${n}.txt`,
      storageKey: randomUUID(),
      sizeBytes: BigInt(n),
      mimeType: n === 3 ? "application/pdf" : "text/plain",
      createdAt: new Date(2026, 0, 1, 0, n),
      updatedAt: new Date(2026, 0, 1, 0, n),
    })),
  });
  return {
    user,
    root,
    folder,
    files: await db.file.findMany({ where: { ownerUserId: user.id } }),
  };
}

it("pages the complete natural order, applies filters before the limit, and keeps private rows out", async () => {
  const { user, folder, files } = await fixture();
  const other = await fixture();
  const options = {
    userId: user.id,
    scope: "folder" as const,
    folderId: folder.id,
  };
  const pages = await Promise.all(
    [0, 100, 200].map((offset) =>
      getListWindow({
        ...options,
        query: { offset, sort: "name", direction: "asc" },
      }),
    ),
  );
  const expected = [...files]
    .sort((a, b) =>
      a.originalName.localeCompare(b.originalName, "en", {
        numeric: true,
        sensitivity: "base",
      }),
    )
    .map((file) => file.id);
  expect(pages.map((page) => page.items.length)).toEqual([100, 100, 33]);
  expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(
    expected,
  );
  expect(pages.map((page) => page.total)).toEqual([233, 233, 233]);
  expect(
    (await getListWindow({ ...options, query: { filter: "pdf" } })).items.map(
      (item) => item.id,
    ),
  ).toEqual([files.find((file) => file.mimeType.includes("pdf"))!.id]);
  expect(
    (await getListWindow({ ...options, query: { find: "File 232" } })).total,
  ).toBe(1);
  expect(
    (await getListWindow({ ...options, userId: other.user.id })).total,
  ).toBe(0);
  expect(await getListWindow({ ...options, query: { offset: 10000 } })).toEqual(
    { items: [], total: 233 },
  );
});

it("hydrates only the requested favorite and activity window, including trash in activity", async () => {
  const { user, files } = await fixture();
  await db.favoriteFile.createMany({
    data: files.map((file) => ({ userId: user.id, fileId: file.id })),
  });
  await db.recentFile.createMany({
    data: files.map((file) => ({
      userId: user.id,
      fileId: file.id,
      lastInteractedAt: file.createdAt,
      lastAction: "uploaded",
    })),
  });
  const newest = [...files].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0]!;
  await db.file.update({
    where: { id: newest.id },
    data: { deletedAt: new Date() },
  });
  const recent = await getRetrievalPage(user.id, "recent", { limit: 8 });
  expect(recent.items).toHaveLength(8);
  expect(recent.total).toBe(233);
  expect(recent.items[0]?.id).toBe(newest.id);
  expect(recent.items[0]?.deletedAt).not.toBeNull();
  const live = await getRetrievalPage(user.id, "recent", {
    limit: 8,
    liveOnly: true,
  });
  expect(live.total).toBe(232);
  expect(live.items.every((item) => !item.deletedAt)).toBe(true);
  const favorites = await getRetrievalPage(user.id, "favorites");
  expect(favorites.items).toHaveLength(100);
  expect(favorites.total).toBe(232);
  expect(favorites.items.every((item) => item.isFavorite)).toBe(true);
});

it("keeps search matching and rank order across page boundaries", async () => {
  const { user, folder, files } = await fixture();
  const candidates = [
    {
      id: folder.id,
      kind: "folder",
      name: folder.name,
      pathLabel: `Files / ${folder.name}`,
      updatedAt: folder.updatedAt,
    },
    ...files.map((file) => ({
      id: file.id,
      kind: "file",
      name: file.originalName,
      pathLabel: `Files / ${folder.name} / ${file.originalName}`,
      updatedAt: file.updatedAt,
    })),
  ];
  for (const query of [
    "txt",
    "cafe",
    "file",
    "232",
    "resume",
    "istanbul",
    "łodz",
    "full",
    "photos",
    "ος",
    "οσ",
    "padded.txt",
  ]) {
    const nameCandidates = await db.$queryRaw<
      { id: string }[]
    >`SELECT id FROM "File" WHERE "ownerUserId"=${user.id} AND "searchName" LIKE ('%' || unaccent(lower(${query})) || '%')`;
    const ids = new Set(nameCandidates.map((row) => row.id));
    const expected = candidates
      .filter(
        (item) =>
          item.kind === "folder" ||
          ids.has(item.id) ||
          normalizeSearchText(folder.name).includes(normalizeSearchText(query)),
      )
      .flatMap((item) => {
        const candidate = prepareSearchCandidate(item.name, item.pathLabel);
        const matchKind = getSearchMatchKind(
          normalizeSearchText(query),
          candidate,
        );
        return matchKind ? [{ ...item, ...candidate, matchKind }] : [];
      })
      .sort(compareSearchResults);
    const first = await getSearchPage(user.id, query);
    const second = await getSearchPage(user.id, query, { offset: 50 });
    expect(first.total, query).toBe(expected.length);
    expect(
      [...first.items, ...second.items].map((item) => item.id),
      query,
    ).toEqual(expected.slice(0, 100).map((item) => item.id));
  }
});

it("counts a complete upload burst without sending every member, and resolves all its actions", async () => {
  const { user, files } = await fixture();
  await db.recentFile.createMany({
    data: files.map((file) => ({
      userId: user.id,
      fileId: file.id,
      lastInteractedAt: file.createdAt,
      lastAction: "uploaded",
    })),
  });
  const page = await getActivityPage(user.id);
  expect(page.total).toBe(1);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.batchSize).toBe(233);
  expect(page.items[0]?.batch).toHaveLength(5);
  const selected = await resolveActivitySelection(user.id, {}, [
    page.items[0]!.id,
  ]);
  expect(new Set(selected.map((item) => item.id))).toEqual(
    new Set(files.map((file) => file.id)),
  );
  const filtered = await getActivityPage(user.id, { filter: "pdf" });
  expect(filtered.total).toBe(1);
  expect(filtered.items[0]?.batch).toBeUndefined();
  const head = page.items[0]!.batchAnchor!;
  await db.recentFile.deleteMany({ where: { fileId: head } });
  await expect(
    resolveActivitySelection(user.id, {}, [page.items[0]!.id]),
  ).rejects.toThrow("Activity changed");
});

it("keeps equal-date activity order and selection across load boundaries", async () => {
  const { user, files } = await fixture();
  await db.recentFile.createMany({
    data: files.map((file) => ({
      userId: user.id,
      fileId: file.id,
      lastInteractedAt: new Date("2026-01-01T12:00:00Z"),
      lastAction: "uploaded",
    })),
  });
  const complete = await getListWindow({
    userId: user.id,
    scope: "recent",
    all: true,
  });
  const pages = await Promise.all(
    [0, 100, 200].map((offset) =>
      getListWindow({ userId: user.id, scope: "recent", query: { offset } }),
    ),
  );
  expect(pages.flatMap((page) => page.items)).toEqual(complete.items);
  const activity = await getActivityPage(user.id);
  expect(activity.total).toBe(1);
  expect(activity.items[0]?.batchSize).toBe(233);
  expect(activity.items[0]?.batch?.map((item) => item.id)).toEqual(
    complete.items.slice(0, 5).map((item) => item.id),
  );
});

it("keeps complete folder Details counts across batches and filters", async () => {
  const { user, folder, files } = await fixture();
  await db.folder.createMany({
    data: [
      { ownerUserId: user.id, name: "Child", parentId: folder.id },
      {
        ownerUserId: user.id,
        name: "Trashed",
        parentId: folder.id,
        deletedAt: new Date(),
      },
    ],
  });
  await db.file.update({
    where: { id: files[0]!.id },
    data: { storageStatus: "missing" },
  });
  await db.file.update({
    where: { id: files[1]!.id },
    data: { deletedAt: new Date() },
  });
  const previousInstance = await db.instance.findUnique({
    where: { id: "singleton" },
  });
  await db.instance.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      name: "List regression",
      storageProtocolVersion: 2,
    },
    update: { storageProtocolVersion: 2 },
  });
  try {
    const service = createFilesService();
    for (const query of [
      {},
      { offset: 100 },
      { filter: "pdf" as const },
      { find: "nothing matches" },
    ]) {
      const listing = await service.getFilesListing({
        actorUserId: user.id,
        actorRole: "member",
        folderId: folder.id,
        query,
      });
      expect(listing.counts).toEqual({ folders: 1, files: 231 });
      expect(
        listing.childFolders.length + listing.files.length,
      ).toBeLessThanOrEqual(100);
    }
  } finally {
    if (previousInstance) {
      await db.instance.update({
        where: { id: "singleton" },
        data: {
          storageProtocolVersion: previousInstance.storageProtocolVersion,
        },
      });
    } else {
      await db.instance.delete({ where: { id: "singleton" } });
    }
  }
});

it("opens a bounded viewer window around a file beyond the first batch", async () => {
  const { user, folder, files } = await fixture();
  const target = files.find((file) => file.originalName === "File 180.txt")!;
  const page = await getViewerWindow(user.id, folder.id, {}, target.id);
  expect(page.files).toHaveLength(30);
  expect(page.files.findIndex((file) => file.id === target.id)).toBe(10);
  expect(page.start).toBeGreaterThan(100);
  expect(page.total).toBe(233);
  const next = await getViewerWindow(user.id, folder.id, {
    offset: page.start + 30,
  });
  expect(next.start).toBe(page.start + 30);
  expect(
    page.files.some((file) => next.files.some((other) => other.id === file.id)),
  ).toBe(false);
});

it("keeps recovering files out of quick search and the viewer without hiding private list rows", async () => {
  const { user, folder, files } = await fixture();
  const other = await fixture();
  const file = files[0]!;
  const options = {
    userId: user.id,
    scope: "folder" as const,
    folderId: folder.id,
  };
  const mutation = await db.storageMutation.create({
    data: {
      ownerUserId: user.id,
      kind: "move_file",
      status: "running",
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
  expect((await getListWindow(options)).total).toBe(233);
  expect(
    (await getListWindow({ ...options, query: { usableOnly: true } })).total,
  ).toBe(232);
  const quick = await getSearchPage(user.id, file.originalName, {
    usableOnly: true,
  });
  expect(quick.items.some((item) => item.id === file.id)).toBe(false);
  await db.storageMutation.update({
    where: { id: mutation.id },
    data: { status: "succeeded" },
  });
  const recovery = await db.storageMutation.create({
    data: {
      ownerUserId: user.id,
      kind: "legacy_recovery",
      status: "recovery_required",
      intentJson: {},
    },
  });
  try {
    expect((await getViewerWindow(user.id, folder.id)).total).toBe(0);
    expect(
      (await getSearchPage(user.id, "File", { usableOnly: true })).total,
    ).toBe(0);
    expect((await getViewerWindow(other.user.id, other.folder.id)).total).toBe(
      233,
    );
    await db.storageMutationResource.create({
      data: {
        mutationId: recovery.id,
        resourceKey: "storage:global-recovery",
        fenceToken: 1n,
      },
    });
    expect((await getViewerWindow(other.user.id, other.folder.id)).total).toBe(
      0,
    );
    await db.storageMutationResource.updateMany({
      where: { mutationId: recovery.id },
      data: { releasedAt: new Date() },
    });
    expect((await getViewerWindow(other.user.id, other.folder.id)).total).toBe(
      233,
    );
  } finally {
    await db.storageMutationResource.updateMany({
      where: { mutationId: recovery.id },
      data: { releasedAt: new Date() },
    });
    await db.storageMutation.update({
      where: { id: recovery.id },
      data: { status: "succeeded" },
    });
  }
});
