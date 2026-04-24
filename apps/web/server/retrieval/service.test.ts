import { describe, expect, it } from "vitest";

import type { FileSummary, FolderSummary } from "@/server/files/types";
import { normalizeSearchText } from "@/server/search";
import { createRetrievalService } from "@/server/retrieval/service";
import type {
  FavoriteFileRecord,
  FavoriteFolderRecord,
  RecentFileRecord,
  RecentFolderRecord,
  RetrievalRepository,
} from "@/server/retrieval/types";

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
    updatedAt,
    ownerUsername = ownerUserId,
  }: {
    ownerUserId: string;
    parentId: string | null;
    name: string;
    isFilesRoot?: boolean;
    deletedAt?: Date | null;
    updatedAt?: Date;
    ownerUsername?: string;
  }) => {
    const timestamp = updatedAt ?? nextDate();
    const folder: FolderSummary = {
      id: nextId("folder"),
      ownerUserId,
      ownerUsername,
      parentId,
      name,
      isFilesRoot,
      deletedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
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
    updatedAt,
    ownerUsername = ownerUserId,
  }: {
    ownerUserId: string;
    folderId: string | null;
    name: string;
    mimeType?: string;
    sizeBytes?: number;
    deletedAt?: Date | null;
    updatedAt?: Date;
    ownerUsername?: string;
  }) => {
    const timestamp = updatedAt ?? nextDate();
    const file: FileSummary = {
      id: nextId("file"),
      ownerUserId,
      ownerUsername,
      folderId,
      name,
      mimeType,
      sizeBytes,
      viewerKind: null,
      deletedAt,
      createdAt: timestamp,
      updatedAt: timestamp,
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
    async ensureFilesRoot(ownerUserId) {
      return cloneFolder(ensureFilesRootRecord(ownerUserId));
    },

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

    async listFoldersByOwner(ownerUserId) {
      return state.folders
        .filter(
          (folder) =>
            folder.ownerUserId === ownerUserId && folder.deletedAt === null,
        )
        .map(cloneFolder);
    },

    async listFilesByOwner(ownerUserId) {
      return state.files
        .filter(
          (file) => file.ownerUserId === ownerUserId && file.deletedAt === null,
        )
        .map(cloneFile);
    },

    async searchFilesByOwner(ownerUserId, nameQuery, folderIds) {
      const normalized = normalizeSearchText(nameQuery);
      return state.files
        .filter(
          (file) =>
            file.ownerUserId === ownerUserId &&
            file.deletedAt === null &&
            ((normalized.length > 0 &&
              normalizeSearchText(file.name).includes(normalized)) ||
              folderIds.includes(file.folderId ?? "")),
        )
        .map(cloneFile);
    },

    async listFavoriteFiles(userId) {
      return state.favoriteFiles.filter(
        (favorite) => favorite.userId === userId,
      );
    },

    async listFavoriteFolders(userId) {
      return state.favoriteFolders.filter(
        (favorite) => favorite.userId === userId,
      );
    },

    async listRecentFiles(userId) {
      return state.recentFiles.filter((recent) => recent.userId === userId);
    },

    async listRecentFolders(userId) {
      return state.recentFolders.filter((recent) => recent.userId === userId);
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
      });
    },

    async deleteFileFavorite({ userId, fileId }) {
      state.favoriteFiles = state.favoriteFiles.filter(
        (favorite) =>
          !(favorite.userId === userId && favorite.fileId === fileId),
      );
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
      });
    },

    async deleteFolderFavorite({ userId, folderId }) {
      state.favoriteFolders = state.favoriteFolders.filter(
        (favorite) =>
          !(favorite.userId === userId && favorite.folderId === folderId),
      );
    },

    async upsertRecentFile({ userId, fileId, lastInteractedAt }) {
      const existing = state.recentFiles.find(
        (recent) => recent.userId === userId && recent.fileId === fileId,
      );

      if (existing) {
        existing.lastInteractedAt = lastInteractedAt;
        return;
      }

      state.recentFiles.push({
        userId,
        fileId,
        lastInteractedAt,
      });
    },

    async upsertRecentFolder({ userId, folderId, lastInteractedAt }) {
      const existing = state.recentFolders.find(
        (recent) => recent.userId === userId && recent.folderId === folderId,
      );

      if (existing) {
        existing.lastInteractedAt = lastInteractedAt;
        return;
      }

      state.recentFolders.push({
        userId,
        folderId,
        lastInteractedAt,
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
  it("searches case-insensitively and accent-insensitively", async () => {
    const { repo, ensureFilesRootRecord, addFile } = createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    addFile({
      ownerUserId: "alice",
      folderId: root.id,
      name: "Résumé.md",
    });
    const service = createRetrievalService({ repo });

    const results = await service.search({
      actorUserId: "alice",
      actorRole: "member",
      query: "resume",
    });

    expect(results.map((item) => item.name)).toEqual(["Résumé.md"]);
    expect(results[0]?.matchKind).toBe("exact");
  });

  it("matches extensions and path tokens as exact search hits", async () => {
    const { repo, ensureFilesRootRecord, addFolder, addFile } =
      createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    const finance = addFolder({
      ownerUserId: "alice",
      parentId: root.id,
      name: "Finance",
    });
    addFile({
      ownerUserId: "alice",
      folderId: finance.id,
      name: "budget.xlsx",
    });
    const service = createRetrievalService({ repo });

    const extensionResults = await service.search({
      actorUserId: "alice",
      actorRole: "member",
      query: "xlsx",
    });
    const pathResults = await service.search({
      actorUserId: "alice",
      actorRole: "member",
      query: "finance",
    });

    expect(extensionResults[0]?.matchKind).toBe("exact");
    expect(pathResults[0]?.matchKind).toBe("exact");
  });

  it("orders exact matches before prefix and substring matches", async () => {
    const { repo, ensureFilesRootRecord, addFile } = createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    addFile({
      ownerUserId: "alice",
      folderId: root.id,
      name: "budget",
      updatedAt: new Date("2026-04-02T11:00:00.000Z"),
    });
    addFile({
      ownerUserId: "alice",
      folderId: root.id,
      name: "budgeting.md",
      updatedAt: new Date("2026-04-02T12:00:00.000Z"),
    });
    addFile({
      ownerUserId: "alice",
      folderId: root.id,
      name: "mybudgetsheet.txt",
      updatedAt: new Date("2026-04-02T13:00:00.000Z"),
    });
    const service = createRetrievalService({ repo });

    const results = await service.search({
      actorUserId: "alice",
      actorRole: "member",
      query: "budget",
    });

    expect(results.map((item) => [item.name, item.matchKind])).toEqual([
      ["budget", "exact"],
      ["budgeting.md", "prefix"],
      ["mybudgetsheet.txt", "substring"],
    ]);
  });

  it("breaks search ties deterministically when timestamps match", async () => {
    const { repo, ensureFilesRootRecord, addFolder, addFile } =
      createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    const sharedTimestamp = new Date("2026-04-02T12:00:00.000Z");
    const alpha = addFolder({
      ownerUserId: "alice",
      parentId: root.id,
      name: "Alpha",
      updatedAt: sharedTimestamp,
    });
    const beta = addFolder({
      ownerUserId: "alice",
      parentId: root.id,
      name: "Beta",
      updatedAt: sharedTimestamp,
    });
    addFile({
      ownerUserId: "alice",
      folderId: beta.id,
      name: "report.txt",
      updatedAt: sharedTimestamp,
    });
    addFile({
      ownerUserId: "alice",
      folderId: alpha.id,
      name: "report.txt",
      updatedAt: sharedTimestamp,
    });
    const service = createRetrievalService({ repo });

    const results = await service.search({
      actorUserId: "alice",
      actorRole: "member",
      query: "report",
    });

    expect(results.map((item) => item.pathLabel)).toEqual([
      "Files / Alpha / report.txt",
      "Files / Beta / report.txt",
    ]);
  });

  it("excludes trashed items and the library root from search", async () => {
    const { repo, ensureFilesRootRecord, addFolder, addFile } =
      createMemoryRepository();
    const root = ensureFilesRootRecord("alice");
    addFolder({
      ownerUserId: "alice",
      parentId: root.id,
      name: "Library plans",
      deletedAt: new Date("2026-04-02T13:00:00.000Z"),
    });
    addFile({
      ownerUserId: "alice",
      folderId: root.id,
      name: "library-checklist.txt",
      deletedAt: new Date("2026-04-02T13:05:00.000Z"),
    });
    const service = createRetrievalService({ repo });

    const results = await service.search({
      actorUserId: "alice",
      actorRole: "member",
      query: "library",
    });

    expect(results).toEqual([]);
  });

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

  it("lists favorites as mixed active items ordered by favorite time", async () => {
    const { repo, ensureFilesRootRecord, addFolder, addFile } =
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
    await service.setFileFavorite({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
      isFavorite: true,
    });

    const favorites = await service.listFavorites({
      actorUserId: "alice",
      actorRole: "member",
    });

    expect(
      favorites.map((item) => [item.kind, item.name, item.isFavorite]),
    ).toEqual([
      ["file", "notes.txt", true],
      ["folder", "Projects", true],
    ]);
  });

  it("records recent folder and file interactions as one row per item", async () => {
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
    let currentTime = new Date("2026-04-02T15:00:00.000Z");
    const service = createRetrievalService({
      repo,
      now: () => currentTime,
    });

    await service.recordFolderAccess({
      actorUserId: "alice",
      actorRole: "member",
      folderId: root.id,
    });
    await service.recordFolderAccess({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
    });
    currentTime = new Date("2026-04-02T15:05:00.000Z");
    await service.recordFolderAccess({
      actorUserId: "alice",
      actorRole: "member",
      folderId: folder.id,
    });
    currentTime = new Date("2026-04-02T15:10:00.000Z");
    await service.recordFileAccess({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
    });
    currentTime = new Date("2026-04-02T15:15:00.000Z");
    file.deletedAt = new Date("2026-04-02T15:15:00.000Z");
    await service.recordFileAccess({
      actorUserId: "alice",
      actorRole: "member",
      fileId: file.id,
    });

    expect(state.recentFolders).toHaveLength(1);
    expect(state.recentFiles).toHaveLength(1);

    const recents = await service.listRecent({
      actorUserId: "alice",
      actorRole: "member",
    });

    expect(recents).toEqual([
      expect.objectContaining({
        kind: "folder",
        name: "Projects",
      }),
    ]);
  });
});
