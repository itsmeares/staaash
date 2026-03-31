import { describe, expect, it } from "vitest";

import { LibraryError } from "@/server/library/errors";
import type { LibraryRepository } from "@/server/library/repository";
import { createLibraryService } from "@/server/library/service";
import type { LibraryFolderSummary } from "@/server/library/types";

type MemoryFolderRecord = LibraryFolderSummary & {
  libraryRootKey: string | null;
};

type MemoryState = {
  folders: MemoryFolderRecord[];
  ids: number;
};

const createMemoryRepository = () => {
  const state: MemoryState = {
    folders: [],
    ids: 0,
  };

  const nextId = () => `folder-${++state.ids}`;

  const cloneFolder = (folder: MemoryFolderRecord): LibraryFolderSummary => ({
    id: folder.id,
    ownerUserId: folder.ownerUserId,
    parentId: folder.parentId,
    name: folder.name,
    isLibraryRoot: folder.isLibraryRoot,
    deletedAt: folder.deletedAt,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  });

  const sortByName = (folders: MemoryFolderRecord[]) =>
    [...folders].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    );

  const sortLegacyRoots = (folders: MemoryFolderRecord[]) =>
    [...folders].sort((left, right) => {
      const leftDeletedRank = left.deletedAt ? 1 : 0;
      const rightDeletedRank = right.deletedAt ? 1 : 0;

      return (
        leftDeletedRank - rightDeletedRank ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id)
      );
    });

  const createRecord = ({
    ownerUserId,
    parentId,
    name,
    isLibraryRoot = false,
    libraryRootKey = null,
    deletedAt = null,
  }: {
    ownerUserId: string;
    parentId: string | null;
    name: string;
    isLibraryRoot?: boolean;
    libraryRootKey?: string | null;
    deletedAt?: Date | null;
  }) => {
    const now = new Date(
      `2026-03-31T12:00:${String(state.ids).padStart(2, "0")}Z`,
    );

    return {
      id: nextId(),
      ownerUserId,
      parentId,
      name,
      isLibraryRoot,
      libraryRootKey,
      deletedAt,
      createdAt: now,
      updatedAt: now,
    } satisfies MemoryFolderRecord;
  };

  const repo: LibraryRepository = {
    async ensureLibraryRoot(ownerUserId) {
      const canonicalRoot = state.folders.find(
        (folder) => folder.libraryRootKey === ownerUserId,
      );

      if (canonicalRoot) {
        return cloneFolder(canonicalRoot);
      }

      const legacyRoots = sortLegacyRoots(
        state.folders.filter(
          (folder) =>
            folder.ownerUserId === ownerUserId && folder.isLibraryRoot,
        ),
      );

      if (legacyRoots.length === 0) {
        const folder = createRecord({
          ownerUserId,
          parentId: null,
          name: "Library",
          isLibraryRoot: true,
          libraryRootKey: ownerUserId,
        });

        state.folders.push(folder);
        return cloneFolder(folder);
      }

      const [canonicalLegacyRoot, ...duplicateRoots] = legacyRoots;
      canonicalLegacyRoot.libraryRootKey = ownerUserId;
      canonicalLegacyRoot.isLibraryRoot = true;
      canonicalLegacyRoot.parentId = null;
      canonicalLegacyRoot.deletedAt = null;

      for (const duplicateRoot of duplicateRoots) {
        duplicateRoot.libraryRootKey = null;
        duplicateRoot.isLibraryRoot = false;
        duplicateRoot.parentId = canonicalLegacyRoot.id;
      }

      return cloneFolder(canonicalLegacyRoot);
    },

    async findFolderById(folderId) {
      const folder = state.folders.find(
        (candidate) => candidate.id === folderId,
      );
      return folder ? cloneFolder(folder) : null;
    },

    async listChildFolders(ownerUserId, parentId, options = {}) {
      const folders = state.folders.filter(
        (folder) =>
          folder.ownerUserId === ownerUserId &&
          folder.parentId === parentId &&
          (options.includeDeleted ? true : folder.deletedAt === null),
      );

      return sortByName(folders).map(cloneFolder);
    },

    async listFoldersByOwner(ownerUserId, options = {}) {
      const folders = state.folders.filter(
        (folder) =>
          folder.ownerUserId === ownerUserId &&
          (options.includeDeleted ? true : folder.deletedAt === null),
      );

      return sortByName(folders).map(cloneFolder);
    },

    async createFolder(params) {
      const folder = createRecord({
        ownerUserId: params.ownerUserId,
        parentId: params.parentId,
        name: params.name,
        isLibraryRoot: params.isLibraryRoot ?? false,
        libraryRootKey: params.isLibraryRoot ? params.ownerUserId : null,
      });

      state.folders.push(folder);
      return cloneFolder(folder);
    },

    async updateFolder(params) {
      const folder = state.folders.find(
        (candidate) => candidate.id === params.id,
      );

      if (!folder) {
        throw new LibraryError("FOLDER_NOT_FOUND");
      }

      if ("name" in params && params.name !== undefined) {
        folder.name = params.name;
      }

      if ("parentId" in params) {
        folder.parentId = params.parentId ?? null;
      }

      if ("deletedAt" in params) {
        folder.deletedAt = params.deletedAt ?? null;
      }

      folder.updatedAt = new Date(
        `2026-03-31T12:02:${String(state.ids).padStart(2, "0")}Z`,
      );
      return cloneFolder(folder);
    },

    async updateFolders(params) {
      for (const folder of state.folders) {
        if (params.ids.includes(folder.id)) {
          folder.deletedAt = params.deletedAt;
          folder.updatedAt = new Date(
            `2026-03-31T12:03:${String(state.ids).padStart(2, "0")}Z`,
          );
        }
      }
    },
  };

  return {
    repo,
    state,
  };
};

describe("library service", () => {
  it("creates a library root on first listing and returns it for /library", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });

    const listing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.currentFolder.isLibraryRoot).toBe(true);
    expect(listing.currentFolder.name).toBe("Library");
    expect(listing.breadcrumbs).toEqual([
      {
        id: listing.currentFolder.id,
        name: "Library",
        href: "/library",
      },
    ]);
  });

  it("does not allow an owner to browse another user's private folder", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const otherRoot = await service.ensureLibraryRoot("member-2");
    const otherFolder = await repo.createFolder({
      ownerUserId: "member-2",
      parentId: otherRoot.id,
      name: "Private",
    });

    await expect(
      service.getLibraryListing({
        actorUserId: "owner-1",
        actorRole: "owner",
        folderId: otherFolder.id,
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
  });

  it("builds breadcrumbs for nested folder navigation", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const projects = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Projects",
    });
    const contracts = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: projects.id,
      name: "Contracts",
    });

    const listing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: contracts.id,
    });

    expect(listing.breadcrumbs.map((crumb) => crumb.name)).toEqual([
      "Library",
      "Projects",
      "Contracts",
    ]);
  });

  it("excludes the current parent, the folder itself, and descendants from move targets", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const source = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Source",
    });
    const sourceChild = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: source.id,
      name: "Source Child",
    });
    const archive = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Archive",
    });

    const listing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.availableMoveTargetIdsByFolderId[source.id]).toEqual([
      archive.id,
    ]);
    expect(listing.availableMoveTargetIdsByFolderId[source.id]).not.toContain(
      root.id,
    );
    expect(listing.availableMoveTargetIdsByFolderId[source.id]).not.toContain(
      source.id,
    );
    expect(listing.availableMoveTargetIdsByFolderId[source.id]).not.toContain(
      sourceChild.id,
    );
  });

  it("preserves folder identity across rename and move operations", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const source = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Source",
    });
    const destination = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Destination",
    });

    const renamed = await service.renameFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: source.id,
      name: "Docs",
    });
    const moved = await service.moveFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: source.id,
      destinationFolderId: destination.id,
    });

    expect(renamed.folder.id).toBe(source.id);
    expect(moved.folder.id).toBe(source.id);
    expect(moved.folder.parentId).toBe(destination.id);
    expect(moved.folder.name).toBe("Docs");
  });

  it("rejects moving a folder into its current parent", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const source = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Source",
    });

    await expect(
      service.moveFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: source.id,
        destinationFolderId: root.id,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_MOVE_NOOP",
    });
  });

  it("rejects moving a folder into its own descendant", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const parent = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Parent",
    });
    const child = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: parent.id,
      name: "Child",
    });

    await expect(
      service.moveFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: parent.id,
        destinationFolderId: child.id,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_MOVE_CYCLE",
    });
  });

  it("keeps the library root immutable across rename, move, trash, and restore", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");

    await expect(
      service.renameFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
        name: "Renamed root",
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_ROOT_IMMUTABLE",
    });

    await expect(
      service.moveFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
        destinationFolderId: null,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_ROOT_IMMUTABLE",
    });

    await expect(
      service.trashFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_ROOT_IMMUTABLE",
    });

    await expect(
      service.restoreFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_ROOT_IMMUTABLE",
    });
  });

  it("rejects cross-user folder mutations", async () => {
    const { repo, state } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const otherRoot = await service.ensureLibraryRoot("member-2");
    const otherFolder = await repo.createFolder({
      ownerUserId: "member-2",
      parentId: otherRoot.id,
      name: "Private",
    });
    const otherDeletedFolder = await repo.createFolder({
      ownerUserId: "member-2",
      parentId: otherRoot.id,
      name: "Deleted private",
    });

    await repo.updateFolders({
      ids: [otherDeletedFolder.id],
      deletedAt: new Date("2026-03-31T13:00:00Z"),
    });

    const deletedRecord = state.folders.find(
      (folder) => folder.id === otherDeletedFolder.id,
    );
    expect(deletedRecord?.deletedAt).not.toBeNull();

    await expect(
      service.createFolder({
        actorUserId: "member-1",
        actorRole: "member",
        parentId: otherRoot.id,
        name: "Intrusion",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });

    await expect(
      service.renameFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: otherFolder.id,
        name: "Renamed",
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });

    await expect(
      service.moveFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: otherFolder.id,
        destinationFolderId: null,
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });

    await expect(
      service.trashFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: otherFolder.id,
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });

    await expect(
      service.restoreFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: otherDeletedFolder.id,
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
  });

  it("allows duplicate sibling folder names", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");

    const first = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Photos",
    });
    const second = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Photos",
    });

    expect(first.folder.id).not.toBe(second.folder.id);
    expect(first.folder.name).toBe("Photos");
    expect(second.folder.name).toBe("Photos");
  });

  it("hides trashed subtrees from active library navigation", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const parent = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Parent",
    });
    const child = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: parent.id,
      name: "Child",
    });

    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.id,
    });

    const rootListing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(rootListing.childFolders).toHaveLength(0);
    await expect(
      service.getLibraryListing({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: child.id,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_NOT_FOUND",
    });
  });

  it("restores a folder to its original parent when that parent is active", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const parent = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Parent",
    });
    const child = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: parent.id,
      name: "Child",
    });

    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.id,
    });

    const restored = await service.restoreFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.id,
    });

    expect(restored.folder.parentId).toBe(parent.id);
    expect(restored.restoredTo).toMatchObject({
      kind: "original-parent",
      folderId: parent.id,
    });
  });

  it("restores a folder to the library root when the original parent is still trashed", async () => {
    const { repo } = createMemoryRepository();
    const service = createLibraryService({ repo });
    const root = await service.ensureLibraryRoot("member-1");
    const parent = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Parent",
    });
    const child = await repo.createFolder({
      ownerUserId: "member-1",
      parentId: parent.id,
      name: "Child",
    });

    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.id,
    });

    const restored = await service.restoreFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.id,
    });

    expect(restored.folder.parentId).toBe(root.id);
    expect(restored.restoredTo).toMatchObject({
      kind: "library-root",
      folderId: root.id,
    });
  });
});
