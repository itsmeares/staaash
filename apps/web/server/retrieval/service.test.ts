import { describe, expect, it } from "vite-plus/test";

import type { FileSummary, FolderSummary } from "@/server/files/types";
import { createRetrievalService } from "@/server/retrieval/service";
import type {
  RecentAction,
  RetrievalRepository,
} from "@/server/retrieval/types";

type FavoriteFileRecord = {
  userId: string;
  fileId: string;
  createdAt: Date;
  quickAccessPinnedAt: Date | null;
};

type FavoriteFolderRecord = {
  userId: string;
  folderId: string;
  createdAt: Date;
  quickAccessPinnedAt: Date | null;
};

type RecentFileRecord = {
  userId: string;
  fileId: string;
  lastInteractedAt: Date;
  lastAction: RecentAction | null;
};

type RecentFolderRecord = {
  userId: string;
  folderId: string;
  lastInteractedAt: Date;
  lastAction: RecentAction | null;
};

type MemoryState = {
  folders: FolderSummary[];
  files: FileSummary[];
  favoriteFiles: FavoriteFileRecord[];
  favoriteFolders: FavoriteFolderRecord[];
  recentFiles: RecentFileRecord[];
  recentFolders: RecentFolderRecord[];
  ids: number;
};

const createMemoryRepository = () => {
  const state: MemoryState = {
    folders: [],
    files: [],
    favoriteFiles: [],
    favoriteFolders: [],
    recentFiles: [],
    recentFolders: [],
    ids: 0,
  };

  const nextId = (prefix: string) => `${prefix}-${++state.ids}`;
  const nextDate = () =>
    new Date(`2026-04-02T10:${String(state.ids).padStart(2, "0")}:00.000Z`);

  const cloneFolder = (folder: FolderSummary): FolderSummary => ({
    ...folder,
  });

  const cloneFile = (file: FileSummary): FileSummary => ({
    ...file,
  });

  const addFolder = ({
    ownerUserId,
    parentId,
    name,
    isFilesRoot = false,
    deletedAt = null,
    createdAt,
    updatedAt,
    ownerStorageId = ownerUserId,
  }: {
    ownerUserId: string;
    parentId: string | null;
    name: string;
    isFilesRoot?: boolean;
    deletedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
    ownerStorageId?: string;
  }) => {
    const timestamp = createdAt ?? updatedAt ?? nextDate();
    const folder: FolderSummary = {
      id: nextId("folder"),
      ownerUserId,
      ownerStorageId,
      parentId,
      name,
      isFilesRoot,
      deletedAt,
      createdAt: timestamp,
      updatedAt: updatedAt ?? timestamp,
    };

    state.folders.push(folder);
    return folder;
  };

  const addFile = ({
    ownerUserId,
    folderId,
    name,
    mimeType = "text/plain",
    sizeBytes = 1024,
    deletedAt = null,
    createdAt,
    updatedAt,
    ownerStorageId = ownerUserId,
  }: {
    ownerUserId: string;
    folderId: string | null;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    deletedAt?: Date | null;
    createdAt?: Date;
    updatedAt?: Date;
    ownerStorageId?: string;
  }) => {
    const timestamp = createdAt ?? updatedAt ?? nextDate();
    const file: FileSummary = {
      id: nextId("file"),
      ownerUserId,
      ownerStorageId,
      folderId,
      name,
      mimeType,
      sizeBytes,
      viewerKind: null,
      deletedAt,
      createdAt: timestamp,
      updatedAt: updatedAt ?? timestamp,
    };

    state.files.push(file);
    return file;
  };

  const ensureFilesRootRecord = (ownerUserId: string) => {
    const existing = state.folders.find(
      (folder) => folder.ownerUserId === ownerUserId && folder.isFilesRoot,
    );

    if (existing) {
      return existing;
    }

    return addFolder({
      ownerUserId,
      parentId: null,
      name: "Files",
      isFilesRoot: true,
    });
  };

  const repo: RetrievalRepository = {
    async findFolderById(folderId) {
      const folder = state.folders.find(
        (candidate) => candidate.id === folderId,
      );
      return folder ? cloneFolder(folder) : null;
    },

    async findFileById(fileId) {
      const file = state.files.find((candidate) => candidate.id === fileId);
      return file ? cloneFile(file) : null;
    },

    async upsertFileFavorite({ userId, fileId, createdAt }) {
      const existing = state.favoriteFiles.find(
        (favorite) => favorite.userId === userId && favorite.fileId === fileId,
      );

      if (existing) {
        return;
      }

      state.favoriteFiles.push({
        userId,
        fileId,
        createdAt,
        quickAccessPinnedAt: null,
      });
    },

    async deleteFileFavorite({ userId, fileId }) {
      state.favoriteFiles = state.favoriteFiles.filter(
        (favorite) =>
          !(favorite.userId === userId && favorite.fileId === fileId),
      );
    },

    async updateFileFavoriteQuickAccess({
      userId,
      fileId,
      quickAccessPinnedAt,
    }) {
      const existing = state.favoriteFiles.find(
        (favorite) => favorite.userId === userId && favorite.fileId === fileId,
      );

      if (!existing) return false;
      existing.quickAccessPinnedAt = quickAccessPinnedAt;
      return true;
    },

    async upsertFolderFavorite({ userId, folderId, createdAt }) {
      const existing = state.favoriteFolders.find(
        (favorite) =>
          favorite.userId === userId && favorite.folderId === folderId,
      );

      if (existing) {
        return;
      }

      state.favoriteFolders.push({
        userId,
        folderId,
        createdAt,
        quickAccessPinnedAt: null,
      });
    },

    async deleteFolderFavorite({ userId, folderId }) {
      state.favoriteFolders = state.favoriteFolders.filter(
        (favorite) =>
          !(favorite.userId === userId && favorite.folderId === folderId),
      );
    },

    async updateFolderFavoriteQuickAccess({
      userId,
      folderId,
      quickAccessPinnedAt,
    }) {
      const existing = state.favoriteFolders.find(
        (favorite) =>
          favorite.userId === userId && favorite.folderId === folderId,
      );

      if (!existing) return false;
      existing.quickAccessPinnedAt = quickAccessPinnedAt;
      return true;
    },

    async upsertRecentFile({ userId, fileId, lastInteractedAt, lastAction }) {
      const existing = state.recentFiles.find(
        (recent) => recent.userId === userId && recent.fileId === fileId,
      );

      if (existing) {
        existing.lastInteractedAt = lastInteractedAt;
        existing.lastAction = lastAction;
        return;
      }

      state.recentFiles.push({
        userId,
        fileId,
        lastInteractedAt,
        lastAction,
      });
    },

    async upsertRecentFolder({
      userId,
      folderId,
      lastInteractedAt,
      lastAction,
    }) {
      const existing = state.recentFolders.find(
        (recent) => recent.userId === userId && recent.folderId === folderId,
      );

      if (existing) {
        existing.lastInteractedAt = lastInteractedAt;
        existing.lastAction = lastAction;
        return;
      }

      state.recentFolders.push({
        userId,
        folderId,
        lastInteractedAt,
        lastAction,
      });
    },
  };

  return {
    repo,
    state,
    addFolder,
    addFile,
    ensureFilesRootRecord,
  };
};

describe("retrieval service", () => {
  it("adds and removes favorites for files and folders idempotently", async () => {
    const { repo, ensureFilesRootRecord, addFolder, addFile, state } =
      createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    const folder = addFolder({
      ownerUserId: "alice",
      parentId: root.id,
      name: "Projects",
    });
    const file = addFile({
      ownerUserId: "alice",
      folderId: folder.id,
      name: "notes.txt",
    });
    let currentTime = new Date("2026-04-02T14:00:00.000Z");
    const service = createRetrievalService({
      repo,
      now: () => currentTime,
    });

    await service.setFolderFavorite({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
      isFavorite: true,
    });
    currentTime = new Date("2026-04-02T14:05:00.000Z");
    await service.setFolderFavorite({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
      isFavorite: true,
    });
    await service.setFileFavorite({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
      isFavorite: true,
    });

    expect(state.favoriteFolders).toHaveLength(1);
    expect(state.favoriteFiles).toHaveLength(1);

    await service.setFolderFavorite({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
      isFavorite: false,
    });
    await service.setFolderFavorite({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
      isFavorite: false,
    });
    await service.setFileFavorite({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
      isFavorite: false,
    });

    expect(state.favoriteFolders).toEqual([]);
    expect(state.favoriteFiles).toEqual([]);
  });

  it("keeps favorites owner-scoped", async () => {
    const { repo, ensureFilesRootRecord, addFile } = createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    const file = addFile({
      ownerUserId: "alice",
      folderId: root.id,
      name: "private.txt",
    });
    const service = createRetrievalService({ repo });

    await expect(
      service.setFileFavorite({
        actorUserId: "bob",
        actorRole: "member",
        fileId: file.id,
        isFavorite: true,
      }),
    ).rejects.toMatchObject({
      code: "ACCESS_DENIED",
    });
  });

  it("pins only existing favorites to quick access", async () => {
    const { repo, ensureFilesRootRecord, addFolder, addFile, state } =
      createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    const folder = addFolder({
      ownerUserId: "alice",
      parentId: root.id,
      name: "Projects",
    });
    const file = addFile({
      ownerUserId: "alice",
      folderId: folder.id,
      name: "notes.txt",
    });
    let currentTime = new Date("2026-04-02T14:00:00.000Z");
    const service = createRetrievalService({
      repo,
      now: () => currentTime,
    });

    await expect(
      service.setFileFavoriteQuickAccess({
        actorUserId: "alice",
        actorRole: "member",
        fileId: file.id,
        quickAccessPinned: true,
      }),
    ).rejects.toMatchObject({
      code: "FILE_NOT_FOUND",
    });

    await service.setFileFavorite({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
      isFavorite: true,
    });
    await service.setFolderFavorite({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
      isFavorite: true,
    });

    currentTime = new Date("2026-04-02T14:10:00.000Z");
    await service.setFileFavoriteQuickAccess({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
      quickAccessPinned: true,
    });
    currentTime = new Date("2026-04-02T14:20:00.000Z");
    await service.setFolderFavoriteQuickAccess({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
      quickAccessPinned: true,
    });

    expect(state.favoriteFiles[0]?.quickAccessPinnedAt?.toISOString()).toBe(
      "2026-04-02T14:10:00.000Z",
    );
    expect(state.favoriteFolders[0]?.quickAccessPinnedAt?.toISOString()).toBe(
      "2026-04-02T14:20:00.000Z",
    );

    await service.setFileFavoriteQuickAccess({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
      quickAccessPinned: false,
    });

    expect(state.favoriteFiles[0]?.quickAccessPinnedAt).toBeNull();
    expect(state.favoriteFolders[0]?.quickAccessPinnedAt).toEqual(
      new Date("2026-04-02T14:20:00.000Z"),
    );
  });
});
