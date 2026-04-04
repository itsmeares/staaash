import { access, readFile, rm } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { LibraryError } from "@/server/library/errors";
import type { LibraryRepository } from "@/server/library/repository";
import { createLibraryService } from "@/server/library/service";
import { getStoragePath } from "@/server/storage";
import type {
  LibraryFileSummary,
  LibraryFolderSummary,
  StoredLibraryFile,
} from "@/server/library/types";

type MemoryFolderRecord = LibraryFolderSummary & {};

type MemoryState = {
  folders: MemoryFolderRecord[];
  files: StoredLibraryFile[];
  ids: number;
  deleteFileError: Error | null;
  updateFileError: Error | null;
};

const createMemoryRepository = () => {
  const state: MemoryState = {
    folders: [],
    files: [],
    ids: 0,
    deleteFileError: null,
    updateFileError: null,
  };

  const nextId = (prefix: string) => `${prefix}-${++state.ids}`;
  const nextDate = () =>
    new Date(`2026-03-31T12:${String(state.ids).padStart(2, "0")}:00Z`);

  const cloneFolder = (folder: MemoryFolderRecord): LibraryFolderSummary => ({
    id: folder.id,
    ownerUserId: folder.ownerUserId,
    ownerUsername: folder.ownerUsername,
    parentId: folder.parentId,
    name: folder.name,
    isLibraryRoot: folder.isLibraryRoot,
    deletedAt: folder.deletedAt,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  });

  const cloneFile = (file: StoredLibraryFile): StoredLibraryFile => ({
    ...file,
    deletedAt: file.deletedAt,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
  });

  const sortFolders = (folders: MemoryFolderRecord[]) =>
    [...folders].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    );

  const sortFiles = (files: StoredLibraryFile[]) =>
    [...files].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    );

  const addFolder = ({
    ownerUserId,
    parentId,
    name,
    isLibraryRoot = false,
    deletedAt = null,
    ownerUsername = ownerUserId,
  }: {
    ownerUserId: string;
    parentId: string | null;
    name: string;
    isLibraryRoot?: boolean;
    deletedAt?: Date | null;
    ownerUsername?: string;
  }) => {
    const now = nextDate();
    const folder: MemoryFolderRecord = {
      id: nextId("folder"),
      ownerUserId,
      ownerUsername,
      parentId,
      name,
      isLibraryRoot,
      deletedAt,
      createdAt: now,
      updatedAt: now,
    };

    state.folders.push(folder);
    return folder;
  };

  const addFile = ({
    ownerUserId,
    folderId,
    name,
    storageKey,
    mimeType = "text/plain",
    sizeBytes = 5,
    contentChecksum = null,
    deletedAt = null,
    ownerUsername = ownerUserId,
  }: {
    ownerUserId: string;
    folderId: string | null;
    name: string;
    storageKey: string;
    mimeType?: string;
    sizeBytes?: number;
    contentChecksum?: string | null;
    deletedAt?: Date | null;
    ownerUsername?: string;
  }) => {
    const now = nextDate();
    const file: StoredLibraryFile = {
      id: nextId("file"),
      ownerUserId,
      ownerUsername,
      folderId,
      name,
      storageKey,
      mimeType,
      sizeBytes,
      contentChecksum,
      viewerKind: null,
      deletedAt,
      createdAt: now,
      updatedAt: now,
    };

    state.files.push(file);
    return file;
  };

  const repo: LibraryRepository = {
    async ensureLibraryRoot(ownerUserId) {
      const existing = state.folders.find(
        (folder) => folder.ownerUserId === ownerUserId && folder.isLibraryRoot,
      );

      if (existing) {
        return cloneFolder(existing);
      }

      const folder = addFolder({
        ownerUserId,
        parentId: null,
        name: "Library",
        isLibraryRoot: true,
        ownerUsername: ownerUserId,
      });

      return cloneFolder(folder);
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

    async listChildFolders(ownerUserId, parentId, options = {}) {
      return sortFolders(
        state.folders.filter(
          (folder) =>
            folder.ownerUserId === ownerUserId &&
            folder.parentId === parentId &&
            (options.includeDeleted ? true : folder.deletedAt === null),
        ),
      ).map(cloneFolder);
    },

    async listChildFiles(ownerUserId, folderId, options = {}) {
      return sortFiles(
        state.files.filter(
          (file) =>
            file.ownerUserId === ownerUserId &&
            file.folderId === folderId &&
            (options.includeDeleted ? true : file.deletedAt === null),
        ),
      ).map(cloneFile);
    },

    async listFoldersByOwner(ownerUserId, options = {}) {
      return sortFolders(
        state.folders.filter(
          (folder) =>
            folder.ownerUserId === ownerUserId &&
            (options.includeDeleted ? true : folder.deletedAt === null),
        ),
      ).map(cloneFolder);
    },

    async listFilesByOwner(ownerUserId, options = {}) {
      return sortFiles(
        state.files.filter(
          (file) =>
            file.ownerUserId === ownerUserId &&
            (options.includeDeleted ? true : file.deletedAt === null),
        ),
      ).map(cloneFile);
    },

    async createFolder(params) {
      const folder = addFolder({
        ownerUserId: params.ownerUserId,
        parentId: params.parentId,
        name: params.name,
        isLibraryRoot: params.isLibraryRoot ?? false,
      });

      return cloneFolder(folder);
    },

    async createFile(params) {
      const now = nextDate();
      const file: StoredLibraryFile = {
        id: params.id ?? nextId("file"),
        ownerUserId: params.ownerUserId,
        ownerUsername: params.ownerUserId,
        folderId: params.folderId,
        name: params.name,
        storageKey: params.storageKey,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        contentChecksum: params.contentChecksum,
        viewerKind: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      state.files.push(file);
      return cloneFile(file);
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

      folder.updatedAt = nextDate();
      return cloneFolder(folder);
    },

    async updateFile(params) {
      if (state.updateFileError) {
        const error = state.updateFileError;
        state.updateFileError = null;
        throw error;
      }

      const file = state.files.find((candidate) => candidate.id === params.id);

      if (!file) {
        throw new LibraryError("FILE_NOT_FOUND");
      }

      if ("name" in params && params.name !== undefined) {
        file.name = params.name;
      }

      if ("folderId" in params) {
        file.folderId = params.folderId ?? null;
      }

      if ("storageKey" in params && params.storageKey !== undefined) {
        file.storageKey = params.storageKey;
      }

      if ("mimeType" in params && params.mimeType !== undefined) {
        file.mimeType = params.mimeType;
      }

      if ("sizeBytes" in params && params.sizeBytes !== undefined) {
        file.sizeBytes = params.sizeBytes;
      }

      if ("contentChecksum" in params) {
        file.contentChecksum = params.contentChecksum ?? null;
      }

      if ("deletedAt" in params) {
        file.deletedAt = params.deletedAt ?? null;
      }

      file.updatedAt = nextDate();
      return cloneFile(file);
    },

    async updateFolders(params) {
      const updatedAt = nextDate();

      for (const folder of state.folders) {
        if (params.ids.includes(folder.id)) {
          folder.deletedAt = params.deletedAt;
          folder.updatedAt = updatedAt;
        }
      }
    },

    async updateFiles(params) {
      const updatedAt = nextDate();

      for (const file of state.files) {
        if (params.ids.includes(file.id)) {
          file.deletedAt = params.deletedAt;
          file.updatedAt = updatedAt;
        }
      }
    },

    async deleteFile(fileId) {
      if (state.deleteFileError) {
        const error = state.deleteFileError;
        state.deleteFileError = null;
        throw error;
      }

      state.files = state.files.filter((file) => file.id !== fileId);
    },

    async deleteFiles(fileIds) {
      const before = state.files.length;
      state.files = state.files.filter((file) => !fileIds.includes(file.id));
      return before - state.files.length;
    },

    async deleteFolders(folderIds) {
      const before = state.folders.length;
      state.folders = state.folders.filter(
        (folder) => !folderIds.includes(folder.id),
      );
      return before - state.folders.length;
    },
  };

  return {
    repo,
    state,
    addFolder,
    addFile,
    failNextDeleteFile: (error: Error) => {
      state.deleteFileError = error;
    },
    failNextUpdateFile: (error: Error) => {
      state.updateFileError = error;
    },
  };
};

const createService = (repo: LibraryRepository) =>
  createLibraryService({
    repo,
    scheduleStagingCleanupJob: async () => undefined,
  });

const cleanDataRoot = () =>
  rm(getStoragePath(""), {
    recursive: true,
    force: true,
  });

describe("library service", () => {
  it("creates a library root on first listing and includes an empty file list", async () => {
    const { repo } = createMemoryRepository();
    const service = createService(repo);

    const listing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.currentFolder.isLibraryRoot).toBe(true);
    expect(listing.files).toEqual([]);
    expect(listing.breadcrumbs[0]?.name).toBe("Library");
  });

  it("rejects duplicate active sibling folder names", async () => {
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Photos",
    });

    await expect(
      service.createFolder({
        actorUserId: "member-1",
        actorRole: "member",
        parentId: root.id,
        name: "Photos",
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_NAME_CONFLICT",
    });
  });

  it("rejects creating a folder when a file already owns the sibling name", async () => {
    const { repo, addFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");
    addFile({
      ownerUserId: "member-1",
      folderId: root.id,
      name: "Plans",
      storageKey: "library/member-1/Plans",
    });

    await expect(
      service.createFolder({
        actorUserId: "member-1",
        actorRole: "member",
        parentId: root.id,
        name: "Plans",
      }),
    ).rejects.toMatchObject({
      code: "FOLDER_NAME_CONFLICT",
    });
  });

  it("moves, trashes, restores, and permanently deletes files", async () => {
    await cleanDataRoot();
    const { repo, addFolder } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");
    const archive = addFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "Archive",
    });

    const upload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-1",
          originalName: "notes.txt",
          conflictStrategy: "fail",
          file: new File(["hello world"], "notes.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const file = upload.uploadedFiles[0];

    expect(file?.name).toBe("notes.txt");

    const renamed = await service.renameFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: file!.id,
      name: "notes-renamed.txt",
    });
    const moved = await service.moveFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: file!.id,
      destinationFolderId: archive.id,
    });
    const trashed = await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: file!.id,
    });
    const restored = await service.restoreFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: file!.id,
    });

    expect(renamed.file?.name).toBe("notes-renamed.txt");
    expect(moved.file?.folderId).toBe(archive.id);
    expect(trashed.file?.deletedAt).not.toBeNull();
    expect(restored.file?.folderId).toBe(archive.id);

    await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: file!.id,
    });
    const deleted = await service.deleteFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: file!.id,
    });

    expect(deleted.deletedFileId).toBe(file?.id);
    await expect(
      access(getStoragePath(".trash/member-1/Archive/notes-renamed.txt")),
    ).rejects.toBeDefined();
  });

  it("safe-renames uploads when interactive keep-both is selected", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "existing",
          originalName: "photo.jpg",
          conflictStrategy: "fail",
          file: new File(["one"], "photo.jpg", {
            type: "image/jpeg",
          }),
        },
      ],
    });

    const result = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-2",
          originalName: "photo.jpg",
          conflictStrategy: "safeRename",
          file: new File(["two"], "photo.jpg", {
            type: "image/jpeg",
          }),
        },
      ],
    });

    expect(result.conflicts).toEqual([]);
    expect(result.uploadedFiles[0]?.name).toBe("photo (1).jpg");
  });

  it("replaces file content in place when replace is selected", async () => {
    await cleanDataRoot();
    const { repo, state } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    const first = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-1",
          originalName: "replace-me.txt",
          conflictStrategy: "fail",
          file: new File(["before"], "replace-me.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const original = first.uploadedFiles[0];

    const second = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-2",
          originalName: "replace-me.txt",
          conflictStrategy: "replace",
          file: new File(["after"], "replace-me.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    expect(second.uploadedFiles[0]?.id).toBe(original?.id);
    expect(
      state.files.filter((file) => file.name === "replace-me.txt"),
    ).toHaveLength(1);
    await expect(
      readFile(getStoragePath("library/member-1/replace-me.txt"), "utf8"),
    ).resolves.toBe("after");
  });

  it("restores the original file when replace metadata update fails", async () => {
    await cleanDataRoot();
    const { repo, failNextUpdateFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-1",
          originalName: "replace-me.txt",
          conflictStrategy: "fail",
          file: new File(["before"], "replace-me.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    failNextUpdateFile(new Error("metadata write failed"));

    await expect(
      service.uploadFiles({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
        items: [
          {
            clientKey: "upload-2",
            originalName: "replace-me.txt",
            conflictStrategy: "replace",
            file: new File(["after"], "replace-me.txt", {
              type: "text/plain",
            }),
          },
        ],
      }),
    ).rejects.toThrow("metadata write failed");

    await expect(
      readFile(getStoragePath("library/member-1/replace-me.txt"), "utf8"),
    ).resolves.toBe("before");
  });

  it("serializes concurrent same-name uploads without silent overwrite", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    const [first, second] = await Promise.all([
      service.uploadFiles({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
        items: [
          {
            clientKey: "upload-1",
            originalName: "race.txt",
            conflictStrategy: "fail",
            file: new File(["first"], "race.txt", {
              type: "text/plain",
            }),
          },
        ],
      }),
      service.uploadFiles({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: root.id,
        items: [
          {
            clientKey: "upload-2",
            originalName: "race.txt",
            conflictStrategy: "fail",
            file: new File(["second"], "race.txt", {
              type: "text/plain",
            }),
          },
        ],
      }),
    ]);

    expect(first.uploadedFiles.length + second.uploadedFiles.length).toBe(1);
    expect(first.conflicts.length + second.conflicts.length).toBe(1);
    await expect(
      readFile(getStoragePath("library/member-1/race.txt"), "utf8"),
    ).resolves.toBe(first.uploadedFiles.length === 1 ? "first" : "second");
  });

  it("returns explicit conflict details when fail is selected", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Receipts",
    });

    const result = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-1",
          originalName: "Receipts",
          conflictStrategy: "fail",
          file: new File(["contents"], "Receipts", {
            type: "text/plain",
          }),
        },
      ],
    });

    expect(result.uploadedFiles).toEqual([]);
    expect(result.conflicts[0]).toMatchObject({
      clientKey: "upload-1",
      existingKind: "folder",
      existingName: "Receipts",
    });
  });

  it("restores the quarantined file when permanent delete metadata removal fails", async () => {
    await cleanDataRoot();
    const { repo, failNextDeleteFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    const upload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "upload-1",
          originalName: "trash-me.txt",
          conflictStrategy: "fail",
          file: new File(["restore me"], "trash-me.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: upload.uploadedFiles[0]!.id,
    });
    failNextDeleteFile(new Error("db delete failed"));

    await expect(
      service.deleteFile({
        actorUserId: "member-1",
        actorRole: "member",
        fileId: upload.uploadedFiles[0]!.id,
      }),
    ).rejects.toThrow("db delete failed");

    await expect(
      access(getStoragePath(".trash/member-1/trash-me.txt")),
    ).resolves.toBeUndefined();
  });

  it("trashing a folder also trashes descendant files and hides them from separate trash entries", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");
    const parent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Parent",
    });

    const upload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
      items: [
        {
          clientKey: "upload-1",
          originalName: "inside.txt",
          conflictStrategy: "fail",
          file: new File(["hello"], "inside.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
    });

    const listing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
    });
    const trash = await service.listTrashFolders({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.files).toEqual([]);
    expect(trash.items).toHaveLength(1);
    expect(trash.files).toEqual([]);

    const restored = await service.restoreFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
    });

    expect(restored.restoredTo?.folderId).toBe(root.id);
    const refreshed = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
    });
    expect(refreshed.files[0]?.id).toBe(upload.uploadedFiles[0]?.id);
  });

  it("clearTrash skips a folder tree that becomes active again before the locked delete phase", async () => {
    await cleanDataRoot();
    const { repo, addFolder, addFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    // Build a trashed folder tree.
    const trashed = addFolder({
      ownerUserId: "member-1",
      parentId: root.id,
      name: "TrashedFolder",
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    });
    addFile({
      ownerUserId: "member-1",
      folderId: trashed.id,
      name: "inside.txt",
      storageKey: `.trash/member-1/TrashedFolder/inside.txt`,
      deletedAt: new Date("2026-01-01T00:00:00Z"),
    });

    // Intercept findFolderById so that when clearTrash re-fetches inside the
    // locked phase it sees the folder as active (restored by a concurrent op).
    const originalFindFolderById = repo.findFolderById.bind(repo);
    let revalidationCalled = false;

    repo.findFolderById = async (folderId) => {
      const result = await originalFindFolderById(folderId);
      if (result && result.id === trashed.id && !revalidationCalled) {
        revalidationCalled = true;
        // Simulate the folder being restored between snapshot and lock.
        return { ...result, deletedAt: null };
      }
      return result;
    };

    const result = await service.clearTrash({
      actorUserId: "member-1",
      actorRole: "member",
    });

    // The concurrently-restored tree must not be counted.
    expect(result.deletedFolderCount).toBe(0);
    expect(result.deletedFileCount).toBe(0);
  });

  it("clearTrash reports counts based on actual deletions not stale snapshot entries", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");

    // Trash a folder with one child.
    const parent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "ToDelete",
    });
    await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
      items: [
        {
          clientKey: "f1",
          originalName: "child.txt",
          conflictStrategy: "fail",
          file: new File(["x"], "child.txt", { type: "text/plain" }),
        },
      ],
    });
    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
    });

    const result = await service.clearTrash({
      actorUserId: "member-1",
      actorRole: "member",
    });

    // 1 root folder deleted, 0 standalone files (the child file counts through
    // the folder tree path, not the top-level file path).
    expect(result.deletedFolderCount).toBe(1);
    // deletedFileCount from the folder tree path (the child.txt inside the tree).
    expect(result.deletedFileCount).toBeGreaterThanOrEqual(1);
  });

  it("bulk clear removes standalone trashed files and top-level trashed folder trees without touching active items", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureLibraryRoot("member-1");
    const archive = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Archive",
    });
    const keep = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "keep",
          originalName: "keep.txt",
          conflictStrategy: "fail",
          file: new File(["keep"], "keep.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const standalone = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: root.id,
      items: [
        {
          clientKey: "standalone",
          originalName: "standalone.txt",
          conflictStrategy: "fail",
          file: new File(["standalone"], "standalone.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const nested = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: archive.folder.id,
      items: [
        {
          clientKey: "nested",
          originalName: "nested.txt",
          conflictStrategy: "fail",
          file: new File(["nested"], "nested.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: standalone.uploadedFiles[0]!.id,
    });
    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: archive.folder.id,
    });

    const result = await service.clearTrash({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(result).toEqual({
      deletedFolderCount: 1,
      deletedFileCount: 2,
    });

    const listing = await service.getLibraryListing({
      actorUserId: "member-1",
      actorRole: "member",
    });
    const trash = await service.listTrashFolders({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.files.map((file) => file.id)).toEqual([
      keep.uploadedFiles[0]!.id,
    ]);
    expect(listing.childFolders).toEqual([]);
    expect(trash.items).toEqual([]);
    expect(trash.files).toEqual([]);
    await expect(
      access(getStoragePath(".trash/member-1/Archive/nested.txt")),
    ).rejects.toBeDefined();
    await expect(
      access(getStoragePath(".trash/member-1/standalone.txt")),
    ).rejects.toBeDefined();
    await expect(
      access(getStoragePath("library/member-1/keep.txt")),
    ).resolves.toBeUndefined();

    expect(nested.uploadedFiles[0]).toBeDefined();
  });
});
