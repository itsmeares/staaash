import { access, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { FilesError } from "@/server/files/errors";
import type { FilesRepository } from "@/server/files/repository";
import { createFilesService } from "@/server/files/service";
import { getStoragePath, getStorageRoot } from "@/server/storage";
import type {
  FileSummary,
  FolderSummary,
  StoredFile,
} from "@/server/files/types";

vi.mock("@/server/user-storage", () => ({
  assertUserStorageQuotaAvailable: vi.fn().mockResolvedValue(undefined),
}));

type MemoryFolderRecord = FolderSummary & {};

type MemoryState = {
  folders: MemoryFolderRecord[];
  files: StoredFile[];
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

  const cloneFolder = (folder: MemoryFolderRecord): FolderSummary => ({
    id: folder.id,
    ownerUserId: folder.ownerUserId,
    ownerStorageId: folder.ownerStorageId,
    parentId: folder.parentId,
    name: folder.name,
    isFilesRoot: folder.isFilesRoot,
    deletedAt: folder.deletedAt,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  });

  const cloneFile = (file: StoredFile): StoredFile => ({
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

  const sortFiles = (files: StoredFile[]) =>
    [...files].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.createdAt.getTime() - right.createdAt.getTime(),
    );

  const addFolder = ({
    ownerUserId,
    parentId,
    name,
    isFilesRoot = false,
    deletedAt = null,
    ownerStorageId = ownerUserId,
  }: {
    ownerUserId: string;
    parentId: string | null;
    name: string;
    isFilesRoot?: boolean;
    deletedAt?: Date | null;
    ownerStorageId?: string;
  }) => {
    const now = nextDate();
    const folder: MemoryFolderRecord = {
      id: nextId("folder"),
      ownerUserId,
      ownerStorageId,
      parentId,
      name,
      isFilesRoot,
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
    storageStatus = "available",
    storageCheckedAt = null,
    storageMissingAt = null,
    ownerStorageId = ownerUserId,
  }: {
    ownerUserId: string;
    folderId: string | null;
    name: string;
    storageKey: string;
    mimeType?: string;
    sizeBytes?: number;
    contentChecksum?: string | null;
    deletedAt?: Date | null;
    storageStatus?: StoredFile["storageStatus"];
    storageCheckedAt?: Date | null;
    storageMissingAt?: Date | null;
    ownerStorageId?: string;
  }) => {
    const now = nextDate();
    const file: StoredFile = {
      id: nextId("file"),
      ownerUserId,
      ownerStorageId,
      folderId,
      name,
      storageKey,
      mimeType,
      sizeBytes,
      contentChecksum,
      storageStatus,
      storageCheckedAt,
      storageMissingAt,
      viewerKind: null,
      deletedAt,
      createdAt: now,
      updatedAt: now,
    };

    state.files.push(file);
    return file;
  };

  const repo: FilesRepository = {
    async ensureFilesRoot(ownerUserId) {
      const existing = state.folders.find(
        (folder) => folder.ownerUserId === ownerUserId && folder.isFilesRoot,
      );

      if (existing) {
        return cloneFolder(existing);
      }

      const folder = addFolder({
        ownerUserId,
        parentId: null,
        name: "Files",
        isFilesRoot: true,
        ownerStorageId: ownerUserId,
      });

      return cloneFolder(folder);
    },

    async findFolderById(folderId) {
      const folder = state.folders.find(
        (candidate) => candidate.id === folderId,
      );
      return folder ? cloneFolder(folder) : null;
    },

    async findFileById(fileId, options = {}) {
      const file = state.files.find(
        (candidate) =>
          candidate.id === fileId &&
          (options.includeMissing
            ? true
            : candidate.storageStatus === "available"),
      );
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
            (options.includeMissing
              ? true
              : file.storageStatus === "available") &&
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
            (options.includeMissing
              ? true
              : file.storageStatus === "available") &&
            (options.includeDeleted ? true : file.deletedAt === null),
        ),
      ).map(cloneFile);
    },

    async searchFilesByOwner(ownerUserId, nameQuery, folderIds) {
      const normalized = nameQuery.trim().toLowerCase();
      return state.files
        .filter(
          (file) =>
            file.ownerUserId === ownerUserId &&
            file.deletedAt === null &&
            file.storageStatus === "available" &&
            ((normalized.length > 0 &&
              file.name.toLowerCase().includes(normalized)) ||
              folderIds.includes(file.folderId ?? "")),
        )
        .map(cloneFile);
    },

    async createFolder(params) {
      const folder = addFolder({
        ownerUserId: params.ownerUserId,
        parentId: params.parentId,
        name: params.name,
        isFilesRoot: params.isFilesRoot ?? false,
      });

      return cloneFolder(folder);
    },

    async createFile(params) {
      const now = nextDate();
      const file: StoredFile = {
        id: params.id ?? nextId("file"),
        ownerUserId: params.ownerUserId,
        ownerStorageId: params.ownerUserId,
        folderId: params.folderId,
        name: params.name,
        storageKey: params.storageKey,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        contentChecksum: params.contentChecksum,
        storageStatus: "available",
        storageCheckedAt: now,
        storageMissingAt: null,
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
        throw new FilesError("FOLDER_NOT_FOUND");
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
        throw new FilesError("FILE_NOT_FOUND");
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

      if ("storageStatus" in params && params.storageStatus !== undefined) {
        file.storageStatus = params.storageStatus;
      }

      if ("storageCheckedAt" in params) {
        file.storageCheckedAt = params.storageCheckedAt ?? null;
      }

      if ("storageMissingAt" in params) {
        file.storageMissingAt = params.storageMissingAt ?? null;
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

    async markFileStorageMissing(fileId, checkedAt = new Date()) {
      const file = state.files.find((candidate) => candidate.id === fileId);
      if (!file) {
        return;
      }

      file.storageStatus = "missing";
      file.storageCheckedAt = checkedAt;
      file.storageMissingAt = checkedAt;
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

const createService = (repo: FilesRepository) =>
  createFilesService({
    repo,
    scheduleStagingCleanupJob: async () => undefined,
  });

const assertTestStorageRoot = () => {
  const root = path.normalize(getStorageRoot());
  const marker = `${path.sep}.tmp${path.sep}vitest-files`;

  if (!root.includes(marker)) {
    throw new Error(`Refusing to clean non-test storage root: ${root}`);
  }
};

const cleanDataRoot = async () => {
  assertTestStorageRoot();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(getStorageRoot(), {
        recursive: true,
        force: true,
      });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (attempt === 4 || (code !== "ENOTEMPTY" && code !== "EPERM")) {
        throw error;
      }

      await delay(50);
    }
  }
};

describe.sequential("files service", () => {
  it("creates a files root on first listing and includes an empty file list", async () => {
    const { repo } = createMemoryRepository();
    const service = createService(repo);

    const listing = await service.getFilesListing({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.currentFolder.isFilesRoot).toBe(true);
    expect(listing.files).toEqual([]);
    expect(listing.breadcrumbs[0]?.name).toBe("Files");
  });

  it("hides missing storage files from normal listings", async () => {
    const { repo, addFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");
    addFile({
      ownerUserId: "member-1",
      folderId: root.id,
      name: "available.txt",
      storageKey: "files/member-1/available.txt",
    });
    addFile({
      ownerUserId: "member-1",
      folderId: root.id,
      name: "missing.txt",
      storageKey: "files/member-1/missing.txt",
      storageStatus: "missing",
      storageCheckedAt: new Date("2026-05-20T10:00:00.000Z"),
      storageMissingAt: new Date("2026-05-20T10:00:00.000Z"),
    });

    const listing = await service.getFilesListing({
      actorUserId: "member-1",
      actorRole: "member",
    });

    expect(listing.files.map((file) => file.name)).toEqual(["available.txt"]);
  });

  it("rejects duplicate active sibling folder names", async () => {
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");

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
    const root = await service.ensureFilesRoot("member-1");
    addFile({
      ownerUserId: "member-1",
      folderId: root.id,
      name: "Plans",
      storageKey: "files/member-1/Plans",
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

  it("renames an active ancestor without stranding a standalone trashed descendant file", async () => {
    await cleanDataRoot();
    const { repo, state } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");
    const parent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Parent",
    });
    const child = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: parent.folder.id,
      name: "Child",
    });
    const activeUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.folder.id,
      items: [
        {
          clientKey: "active",
          originalName: "active.txt",
          conflictStrategy: "fail",
          file: new File(["active contents"], "active.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const trashedUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.folder.id,
      items: [
        {
          clientKey: "trashed",
          originalName: "trashed.txt",
          conflictStrategy: "fail",
          file: new File(["trashed contents"], "trashed.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const otherRoot = await service.ensureFilesRoot("member-2");
    const otherUpload = await service.uploadFiles({
      actorUserId: "member-2",
      actorRole: "member",
      folderId: otherRoot.id,
      items: [
        {
          clientKey: "other-user",
          originalName: "untouched.txt",
          conflictStrategy: "fail",
          file: new File(["other contents"], "untouched.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: trashedUpload.uploadedFiles[0]!.id,
    });
    await service.renameFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
      name: "Renamed",
    });

    const activeFile = state.files.find(
      (file) => file.id === activeUpload.uploadedFiles[0]!.id,
    );
    const trashedFile = state.files.find(
      (file) => file.id === trashedUpload.uploadedFiles[0]!.id,
    );
    const otherFile = state.files.find(
      (file) => file.id === otherUpload.uploadedFiles[0]!.id,
    );

    expect(activeFile?.storageKey).toBe(
      "files/member-1/Renamed/Child/active.txt",
    );
    expect(trashedFile).toMatchObject({
      folderId: child.folder.id,
      storageKey: ".trash/member-1/Renamed/Child/trashed.txt",
    });
    expect(trashedFile?.deletedAt).not.toBeNull();
    expect(trashedFile?.storageKey.startsWith("files/")).toBe(false);
    await expect(
      access(getStoragePath("files/member-1/Renamed/Child")),
    ).resolves.toBeUndefined();
    await expect(
      access(getStoragePath(".trash/member-1/Parent/Child/trashed.txt")),
    ).rejects.toBeDefined();
    await expect(
      readFile(getStoragePath(trashedFile!.storageKey), "utf8"),
    ).resolves.toBe("trashed contents");
    await expect(
      readFile(getStoragePath(activeFile!.storageKey), "utf8"),
    ).resolves.toBe("active contents");
    await expect(
      access(getStoragePath("files/member-1/Renamed/Child/trashed.txt")),
    ).rejects.toBeDefined();
    expect(otherFile?.storageKey).toBe("files/member-2/untouched.txt");
    await expect(
      readFile(getStoragePath(otherFile!.storageKey), "utf8"),
    ).resolves.toBe("other contents");

    const trash = await service.listTrashFolders({
      actorUserId: "member-1",
      actorRole: "member",
    });
    expect(trash.files).toHaveLength(1);
    expect(trash.files[0]).toMatchObject({
      originalPathLabel: "Files / Renamed / Child / trashed.txt",
      restoreLocation: {
        kind: "original-parent",
        folderId: child.folder.id,
        pathLabel: "Files / Renamed / Child",
      },
    });

    const restored = await service.restoreFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: trashedUpload.uploadedFiles[0]!.id,
    });
    const restoredFile = state.files.find(
      (file) => file.id === trashedUpload.uploadedFiles[0]!.id,
    );

    expect(restored.restoredTo).toMatchObject({
      kind: "original-parent",
      folderId: child.folder.id,
    });
    expect(restoredFile).toMatchObject({
      folderId: child.folder.id,
      storageKey: "files/member-1/Renamed/Child/trashed.txt",
      deletedAt: null,
    });
    await expect(
      readFile(getStoragePath(restoredFile!.storageKey), "utf8"),
    ).resolves.toBe("trashed contents");
  });

  it("does not move an unrelated same-name trashed folder when renaming an active folder", async () => {
    await cleanDataRoot();
    const { repo, state } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");
    const oldParent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Parent",
    });
    const oldUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: oldParent.folder.id,
      items: [
        {
          clientKey: "old-file",
          originalName: "old.txt",
          conflictStrategy: "fail",
          file: new File(["old parent contents"], "old.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: oldParent.folder.id,
    });

    const activeParent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Parent",
    });
    const child = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: activeParent.folder.id,
      name: "Child",
    });
    const activeUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.folder.id,
      items: [
        {
          clientKey: "active-file",
          originalName: "active.txt",
          conflictStrategy: "fail",
          file: new File(["active child contents"], "active.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const descendantUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.folder.id,
      items: [
        {
          clientKey: "descendant-file",
          originalName: "trashed.txt",
          conflictStrategy: "fail",
          file: new File(["active parent trash"], "trashed.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: descendantUpload.uploadedFiles[0]!.id,
    });
    const oldTrashedFileBeforeRename = state.files.find(
      (file) => file.id === oldUpload.uploadedFiles[0]!.id,
    );

    expect(oldTrashedFileBeforeRename?.storageKey).toBe(
      ".trash/member-1/Parent/old.txt",
    );

    await service.renameFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: activeParent.folder.id,
      name: "Renamed",
    });

    const oldTrashedFile = state.files.find(
      (file) => file.id === oldUpload.uploadedFiles[0]!.id,
    );
    const oldTrashedFolder = state.folders.find(
      (folder) => folder.id === oldParent.folder.id,
    );
    const affectedTrashedFile = state.files.find(
      (file) => file.id === descendantUpload.uploadedFiles[0]!.id,
    );
    const activeFile = state.files.find(
      (file) => file.id === activeUpload.uploadedFiles[0]!.id,
    );

    expect(oldTrashedFile).toMatchObject({
      storageKey: ".trash/member-1/Parent/old.txt",
    });
    expect(oldTrashedFile?.deletedAt).not.toBeNull();
    expect(oldTrashedFolder).toMatchObject({
      name: "Parent",
      parentId: root.id,
    });
    expect(oldTrashedFolder?.deletedAt).not.toBeNull();
    await expect(
      readFile(getStoragePath(oldTrashedFile!.storageKey), "utf8"),
    ).resolves.toBe("old parent contents");
    await expect(
      access(getStoragePath(".trash/member-1/Renamed/old.txt")),
    ).rejects.toBeDefined();

    expect(affectedTrashedFile).toMatchObject({
      storageKey: ".trash/member-1/Renamed/Child/trashed.txt",
    });
    expect(affectedTrashedFile?.deletedAt).not.toBeNull();
    await expect(
      readFile(getStoragePath(affectedTrashedFile!.storageKey), "utf8"),
    ).resolves.toBe("active parent trash");
    await expect(
      access(getStoragePath(".trash/member-1/Parent/Child/trashed.txt")),
    ).rejects.toBeDefined();

    expect(activeFile?.storageKey).toBe(
      "files/member-1/Renamed/Child/active.txt",
    );
    await expect(
      readFile(getStoragePath(activeFile!.storageKey), "utf8"),
    ).resolves.toBe("active child contents");

    await service.restoreFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: descendantUpload.uploadedFiles[0]!.id,
    });
    const restoredAffectedFile = state.files.find(
      (file) => file.id === descendantUpload.uploadedFiles[0]!.id,
    );
    expect(restoredAffectedFile).toMatchObject({
      folderId: child.folder.id,
      storageKey: "files/member-1/Renamed/Child/trashed.txt",
      deletedAt: null,
    });
    await expect(
      readFile(getStoragePath(restoredAffectedFile!.storageKey), "utf8"),
    ).resolves.toBe("active parent trash");
    await expect(
      access(getStoragePath(".trash/member-1/Renamed/Child/trashed.txt")),
    ).rejects.toBeDefined();

    const restoredOldParent = await service.restoreFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: oldParent.folder.id,
    });
    const restoredOldFile = state.files.find(
      (file) => file.id === oldUpload.uploadedFiles[0]!.id,
    );
    expect(restoredOldParent.restoredTo).toMatchObject({
      kind: "original-parent",
      folderId: root.id,
    });
    expect(restoredOldFile).toMatchObject({
      storageKey: "files/member-1/Parent/old.txt",
      deletedAt: null,
    });
    await expect(
      readFile(getStoragePath(restoredOldFile!.storageKey), "utf8"),
    ).resolves.toBe("old parent contents");
    await expect(
      access(getStoragePath(".trash/member-1/Parent/old.txt")),
    ).rejects.toBeDefined();
  });

  it("renames an active ancestor without stranding a trashed descendant folder tree", async () => {
    await cleanDataRoot();
    const { repo, state } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");
    const parent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Parent",
    });
    const child = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: parent.folder.id,
      name: "Child",
    });
    const trashedTree = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: child.folder.id,
      name: "TrashedTree",
    });
    const nested = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: trashedTree.folder.id,
      name: "Nested",
    });
    const upload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: nested.folder.id,
      items: [
        {
          clientKey: "nested-file",
          originalName: "inside.txt",
          conflictStrategy: "fail",
          file: new File(["folder tree contents"], "inside.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: trashedTree.folder.id,
    });
    await service.renameFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: parent.folder.id,
      name: "Renamed",
    });

    const trashedFolder = state.folders.find(
      (folder) => folder.id === trashedTree.folder.id,
    );
    const trashedNestedFolder = state.folders.find(
      (folder) => folder.id === nested.folder.id,
    );
    const trashedFile = state.files.find(
      (file) => file.id === upload.uploadedFiles[0]!.id,
    );

    expect(trashedFolder?.deletedAt).not.toBeNull();
    expect(trashedNestedFolder?.deletedAt).not.toBeNull();
    expect(trashedFile).toMatchObject({
      storageKey: ".trash/member-1/Renamed/Child/TrashedTree/Nested/inside.txt",
    });
    expect(trashedFile?.deletedAt).not.toBeNull();
    await expect(
      access(getStoragePath(".trash/member-1/Parent/Child/TrashedTree")),
    ).rejects.toBeDefined();
    await expect(
      readFile(getStoragePath(trashedFile!.storageKey), "utf8"),
    ).resolves.toBe("folder tree contents");
    await expect(
      access(
        getStoragePath(
          "files/member-1/Renamed/Child/TrashedTree/Nested/inside.txt",
        ),
      ),
    ).rejects.toBeDefined();

    const trash = await service.listTrashFolders({
      actorUserId: "member-1",
      actorRole: "member",
    });
    expect(trash.items).toHaveLength(1);
    expect(trash.items[0]).toMatchObject({
      originalPathLabel: "Files / Renamed / Child / TrashedTree",
      restoreLocation: {
        kind: "original-parent",
        folderId: child.folder.id,
        pathLabel: "Files / Renamed / Child",
      },
    });

    const restored = await service.restoreFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: trashedTree.folder.id,
    });
    const restoredFolder = state.folders.find(
      (folder) => folder.id === trashedTree.folder.id,
    );
    const restoredNestedFolder = state.folders.find(
      (folder) => folder.id === nested.folder.id,
    );
    const restoredFile = state.files.find(
      (file) => file.id === upload.uploadedFiles[0]!.id,
    );

    expect(restored.restoredTo).toMatchObject({
      kind: "original-parent",
      folderId: child.folder.id,
    });
    expect(restoredFolder).toMatchObject({
      parentId: child.folder.id,
      deletedAt: null,
    });
    expect(restoredNestedFolder?.deletedAt).toBeNull();
    expect(restoredFile).toMatchObject({
      storageKey: "files/member-1/Renamed/Child/TrashedTree/Nested/inside.txt",
      deletedAt: null,
    });
    await expect(
      readFile(getStoragePath(restoredFile!.storageKey), "utf8"),
    ).resolves.toBe("folder tree contents");
  });

  it("rolls back active and trash paths when folder rename metadata updating fails", async () => {
    await cleanDataRoot();
    const { repo, state, failNextUpdateFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");
    const parent = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: root.id,
      name: "Parent",
    });
    const child = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: parent.folder.id,
      name: "Child",
    });
    const activeUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.folder.id,
      items: [
        {
          clientKey: "active",
          originalName: "active.txt",
          conflictStrategy: "fail",
          file: new File(["active contents"], "active.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const trashedUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: child.folder.id,
      items: [
        {
          clientKey: "trashed",
          originalName: "trashed.txt",
          conflictStrategy: "fail",
          file: new File(["trashed contents"], "trashed.txt", {
            type: "text/plain",
          }),
        },
      ],
    });
    const trashedTree = await service.createFolder({
      actorUserId: "member-1",
      actorRole: "member",
      parentId: child.folder.id,
      name: "TrashedTree",
    });
    const treeUpload = await service.uploadFiles({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: trashedTree.folder.id,
      items: [
        {
          clientKey: "tree-file",
          originalName: "inside.txt",
          conflictStrategy: "fail",
          file: new File(["tree contents"], "inside.txt", {
            type: "text/plain",
          }),
        },
      ],
    });

    await service.trashFile({
      actorUserId: "member-1",
      actorRole: "member",
      fileId: trashedUpload.uploadedFiles[0]!.id,
    });
    await service.trashFolder({
      actorUserId: "member-1",
      actorRole: "member",
      folderId: trashedTree.folder.id,
    });
    failNextUpdateFile(new Error("rename metadata failed"));

    await expect(
      service.renameFolder({
        actorUserId: "member-1",
        actorRole: "member",
        folderId: parent.folder.id,
        name: "Renamed",
      }),
    ).rejects.toThrow("rename metadata failed");

    expect(
      state.folders.find((folder) => folder.id === parent.folder.id)?.name,
    ).toBe("Parent");
    expect(
      state.files.find((file) => file.id === activeUpload.uploadedFiles[0]!.id)
        ?.storageKey,
    ).toBe("files/member-1/Parent/Child/active.txt");
    expect(
      state.files.find((file) => file.id === trashedUpload.uploadedFiles[0]!.id)
        ?.storageKey,
    ).toBe(".trash/member-1/Parent/Child/trashed.txt");
    expect(
      state.files.find((file) => file.id === treeUpload.uploadedFiles[0]!.id)
        ?.storageKey,
    ).toBe(".trash/member-1/Parent/Child/TrashedTree/inside.txt");
    await expect(
      readFile(
        getStoragePath("files/member-1/Parent/Child/active.txt"),
        "utf8",
      ),
    ).resolves.toBe("active contents");
    await expect(
      readFile(
        getStoragePath(".trash/member-1/Parent/Child/trashed.txt"),
        "utf8",
      ),
    ).resolves.toBe("trashed contents");
    await expect(
      readFile(
        getStoragePath(".trash/member-1/Parent/Child/TrashedTree/inside.txt"),
        "utf8",
      ),
    ).resolves.toBe("tree contents");
    await expect(
      access(getStoragePath("files/member-1/Renamed")),
    ).rejects.toBeDefined();
    await expect(
      access(getStoragePath(".trash/member-1/Renamed/Child/trashed.txt")),
    ).rejects.toBeDefined();
    await expect(
      access(getStoragePath(".trash/member-1/Renamed/Child/TrashedTree")),
    ).rejects.toBeDefined();
  });

  it("moves, trashes, restores, and permanently deletes files", async () => {
    await cleanDataRoot();
    const { repo, addFolder } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");
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
    const root = await service.ensureFilesRoot("member-1");

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
    const root = await service.ensureFilesRoot("member-1");

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
      readFile(getStoragePath("files/member-1/replace-me.txt"), "utf8"),
    ).resolves.toBe("after");
  });

  it("restores the original file when replace metadata update fails", async () => {
    await cleanDataRoot();
    const { repo, failNextUpdateFile } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");

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
      readFile(getStoragePath("files/member-1/replace-me.txt"), "utf8"),
    ).resolves.toBe("before");
  });

  it("serializes concurrent same-name uploads without silent overwrite", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");

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
      readFile(getStoragePath("files/member-1/race.txt"), "utf8"),
    ).resolves.toBe(first.uploadedFiles.length === 1 ? "first" : "second");
  });

  it("returns explicit conflict details when fail is selected", async () => {
    await cleanDataRoot();
    const { repo } = createMemoryRepository();
    const service = createService(repo);
    const root = await service.ensureFilesRoot("member-1");

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
    const root = await service.ensureFilesRoot("member-1");

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
    const root = await service.ensureFilesRoot("member-1");
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

    const listing = await service.getFilesListing({
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
    const refreshed = await service.getFilesListing({
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
    const root = await service.ensureFilesRoot("member-1");

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
    const root = await service.ensureFilesRoot("member-1");

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
    const root = await service.ensureFilesRoot("member-1");
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

    const listing = await service.getFilesListing({
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
      access(getStoragePath("files/member-1/keep.txt")),
    ).resolves.toBeUndefined();

    expect(nested.uploadedFiles[0]).toBeDefined();
  });
});
