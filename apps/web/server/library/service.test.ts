import { describe, expect, it } from "vitest";

import { LibraryError } from "@/server/library/errors";
import type { LibraryRepository } from "@/server/library/repository";
import { createLibraryService } from "@/server/library/service";
import type { LibraryFolderSummary } from "@/server/library/types";

type MemoryState = {
  folders: LibraryFolderSummary[];
  ids: number;
};

const createMemoryRepository = () => {
  const state: MemoryState = {
    folders: [],
    ids: 0,
  };

  const nextId = () => `folder-${++state.ids}`;

  const cloneFolder = (folder: LibraryFolderSummary): LibraryFolderSummary => ({
    ...folder,
  });

  const sortByName = (folders: LibraryFolderSummary[]) =>
    [...folders].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    );

  const repo: LibraryRepository = {
    async findLibraryRootByOwnerUserId(ownerUserId) {
      return (
        state.folders.find(
          (folder) =>
            folder.ownerUserId === ownerUserId && folder.isLibraryRoot,
        ) ?? null
      );
    },

    async createLibraryRoot(ownerUserId) {
      const now = new Date(`2026-03-31T12:00:0${state.ids}Z`);
      const folder = {
        id: nextId(),
        ownerUserId,
        parentId: null,
        name: "Library",
        isLibraryRoot: true,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      state.folders.push(folder);
      return cloneFolder(folder);
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
      const now = new Date(`2026-03-31T12:01:${state.ids}Z`);
      const folder = {
        id: nextId(),
        ownerUserId: params.ownerUserId,
        parentId: params.parentId,
        name: params.name,
        isLibraryRoot: params.isLibraryRoot ?? false,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

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

      folder.updatedAt = new Date(`2026-03-31T12:02:${state.ids}Z`);
      return cloneFolder(folder);
    },

    async updateFolders(params) {
      for (const folder of state.folders) {
        if (params.ids.includes(folder.id)) {
          folder.deletedAt = params.deletedAt;
          folder.updatedAt = new Date(`2026-03-31T12:03:${state.ids}Z`);
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

  it("keeps the library root immutable", async () => {
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
      service.trashFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_ROOT_IMMUTABLE",
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
