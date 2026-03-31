import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import { canAccessPrivateNamespace } from "@/server/access";
import { LibraryError } from "@/server/library/errors";
import type {
  FileMutationResult,
  FolderMutationResult,
  FolderRestoreLocation,
  LibraryActor,
  LibraryBreadcrumb,
  LibraryFileSummary,
  LibraryFolderSummary,
  LibraryListing,
  LibraryMoveTarget,
  StoredLibraryFile,
  TrashFileSummary,
  TrashFolderSummary,
  TrashListing,
} from "@/server/library/types";
import {
  buildStoredFileRef,
  getStoragePath,
} from "@/server/storage";
import {
  buildSafeRenamedFileName,
  cleanupStagedUpload,
  commitStagedUpload,
  replaceCommittedUpload,
  stageUpload,
} from "@/server/uploads";
import type {
  UploadConflictStrategy,
  UploadRequestItem,
} from "@/server/uploads";

import type { LibraryRepository } from "./repository";

type CreateLibraryServiceOptions = {
  repo?: LibraryRepository;
  now?: () => Date;
  scheduleStagingCleanupJob?: (runAt: Date) => Promise<void>;
};

type FolderLookupInput = LibraryActor & {
  folderId: string;
};

type FileLookupInput = LibraryActor & {
  fileId: string;
};

type CreateFolderInput = LibraryActor & {
  parentId?: string | null;
  name: string;
};

type RenameFolderInput = LibraryActor & {
  folderId: string;
  name: string;
};

type MoveFolderInput = LibraryActor & {
  folderId: string;
  destinationFolderId?: string | null;
};

type RenameFileInput = LibraryActor & {
  fileId: string;
  name: string;
};

type MoveFileInput = LibraryActor & {
  fileId: string;
  destinationFolderId?: string | null;
};

type UploadFilesInput = LibraryActor & {
  folderId?: string | null;
  items: UploadRequestItem[];
};

type ActiveNameConflict =
  | {
      kind: "file";
      item: StoredLibraryFile;
    }
  | {
      kind: "folder";
      item: LibraryFolderSummary;
    };

type UploadConflictItem = {
  clientKey: string;
  originalName: string;
  conflictStrategy: UploadConflictStrategy;
  existingKind: "file" | "folder";
  existingId: string;
  existingName: string;
};

type UploadFilesResult = {
  uploadedFiles: LibraryFileSummary[];
  conflicts: UploadConflictItem[];
};

const getFolderHref = (
  folder: Pick<LibraryFolderSummary, "id" | "isLibraryRoot">,
) => (folder.isLibraryRoot ? "/library" : `/library/f/${folder.id}`);

const normalizeFolderName = (value: string) => {
  const name = value.trim();

  if (name.length === 0) {
    throw new LibraryError("FOLDER_NAME_REQUIRED");
  }

  if (/[\\/]/.test(name)) {
    throw new LibraryError("FOLDER_NAME_INVALID");
  }

  return name;
};

const normalizeFileName = (value: string) => {
  const name = value.trim();

  if (name.length === 0) {
    throw new LibraryError("FILE_NAME_REQUIRED");
  }

  if (/[\\/]/.test(name)) {
    throw new LibraryError("FILE_NAME_INVALID");
  }

  return name;
};

const toLibraryFileSummary = (
  file: Pick<
    StoredLibraryFile,
    | "id"
    | "ownerUserId"
    | "folderId"
    | "name"
    | "mimeType"
    | "sizeBytes"
    | "deletedAt"
    | "createdAt"
    | "updatedAt"
  >,
): LibraryFileSummary => ({
  id: file.id,
  ownerUserId: file.ownerUserId,
  folderId: file.folderId,
  name: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  deletedAt: file.deletedAt,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const assertFolderAccess = (
  actor: LibraryActor,
  folder: LibraryFolderSummary | null,
) => {
  if (!folder) {
    throw new LibraryError("FOLDER_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: actor.actorRole,
      actorUserId: actor.actorUserId,
      namespaceOwnerUserId: folder.ownerUserId,
    })
  ) {
    throw new LibraryError("ACCESS_DENIED");
  }

  return folder;
};

const assertFileAccess = (actor: LibraryActor, file: StoredLibraryFile | null) => {
  if (!file) {
    throw new LibraryError("FILE_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: actor.actorRole,
      actorUserId: actor.actorUserId,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new LibraryError("ACCESS_DENIED");
  }

  return file;
};

const assertActiveFolder = (folder: LibraryFolderSummary) => {
  if (folder.deletedAt) {
    throw new LibraryError("FOLDER_NOT_FOUND");
  }

  return folder;
};

const assertActiveFile = (file: StoredLibraryFile) => {
  if (file.deletedAt) {
    throw new LibraryError("FILE_NOT_FOUND");
  }

  return file;
};

const assertMutableFolder = (folder: LibraryFolderSummary) => {
  if (folder.isLibraryRoot) {
    throw new LibraryError("FOLDER_ROOT_IMMUTABLE");
  }
};

const buildFolderPathLabel = ({
  folder,
  folderMap,
  libraryRoot,
}: {
  folder: LibraryFolderSummary;
  folderMap: Map<string, LibraryFolderSummary>;
  libraryRoot: LibraryFolderSummary;
}) => {
  const names: string[] = [];
  const seen = new Set<string>();
  let current: LibraryFolderSummary | undefined = folder;
  let reachedRoot = false;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);

    if (current.id === libraryRoot.id) {
      reachedRoot = true;
      break;
    }

    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  if (!reachedRoot) {
    names.unshift(libraryRoot.name);
  }

  return names.join(" / ");
};

const buildFilePathLabel = ({
  file,
  folderMap,
  libraryRoot,
}: {
  file: LibraryFileSummary;
  folderMap: Map<string, LibraryFolderSummary>;
  libraryRoot: LibraryFolderSummary;
}) => {
  const parent =
    file.folderId && folderMap.has(file.folderId)
      ? folderMap.get(file.folderId)
      : libraryRoot;

  const folderPath = parent
    ? buildFolderPathLabel({
        folder: parent,
        folderMap,
        libraryRoot,
      })
    : libraryRoot.name;

  return `${folderPath} / ${file.name}`;
};

export const createLibraryService = ({
  repo,
  now = () => new Date(),
  scheduleStagingCleanupJob,
}: CreateLibraryServiceOptions = {}) => {
  const resolveRepo = async (): Promise<LibraryRepository> =>
    repo ?? (await import("./repository")).prismaLibraryRepository;

  const ensureLibraryRoot = async (ownerUserId: string) => {
    const activeRepo = await resolveRepo();
    return activeRepo.ensureLibraryRoot(ownerUserId);
  };

  const getOwnedFolder = async ({
    actorRole,
    actorUserId,
    folderId,
  }: FolderLookupInput) =>
    assertFolderAccess(
      {
        actorRole,
        actorUserId,
      },
      await (await resolveRepo()).findFolderById(folderId),
    );

  const getOwnedFile = async ({
    actorRole,
    actorUserId,
    fileId,
  }: FileLookupInput) =>
    assertFileAccess(
      {
        actorRole,
        actorUserId,
      },
      await (await resolveRepo()).findFileById(fileId),
    );

  const getActiveOwnedFolder = async (input: FolderLookupInput) =>
    assertActiveFolder(await getOwnedFolder(input));

  const getActiveOwnedFile = async (input: FileLookupInput) =>
    assertActiveFile(await getOwnedFile(input));

  const collectDescendants = async ({
    ownerUserId,
    folderId,
    includeDeleted = true,
  }: {
    ownerUserId: string;
    folderId: string;
    includeDeleted?: boolean;
  }) => {
    const activeRepo = await resolveRepo();
    const descendants: LibraryFolderSummary[] = [];
    const queue = [folderId];

    while (queue.length > 0) {
      const currentFolderId = queue.shift();

      if (!currentFolderId) {
        continue;
      }

      const children = await activeRepo.listChildFolders(
        ownerUserId,
        currentFolderId,
        {
          includeDeleted,
        },
      );

      descendants.push(...children);
      queue.push(...children.map((child) => child.id));
    }

    return descendants;
  };

  const collectFilesInFolders = async ({
    ownerUserId,
    folderIds,
    includeDeleted = true,
  }: {
    ownerUserId: string;
    folderIds: Set<string>;
    includeDeleted?: boolean;
  }) => {
    const files = await (await resolveRepo()).listFilesByOwner(ownerUserId, {
      includeDeleted,
    });

    return files.filter((file) => file.folderId && folderIds.has(file.folderId));
  };

  const buildBreadcrumbs = async (
    currentFolder: LibraryFolderSummary,
    libraryRoot: LibraryFolderSummary,
  ): Promise<LibraryBreadcrumb[]> => {
    if (currentFolder.id === libraryRoot.id) {
      return [
        {
          id: libraryRoot.id,
          name: libraryRoot.name,
          href: "/library",
        },
      ];
    }

    const activeRepo = await resolveRepo();
    const trail: LibraryFolderSummary[] = [currentFolder];
    const seen = new Set([currentFolder.id]);
    let parentId = currentFolder.parentId;
    let reachedRoot = false;

    while (parentId && !seen.has(parentId)) {
      const parent = await activeRepo.findFolderById(parentId);

      if (!parent) {
        break;
      }

      trail.unshift(parent);
      seen.add(parent.id);

      if (parent.id === libraryRoot.id) {
        reachedRoot = true;
        break;
      }

      parentId = parent.parentId;
    }

    if (!reachedRoot) {
      trail.unshift(libraryRoot);
    }

    return trail.map((folder) => ({
      id: folder.id,
      name: folder.name,
      href: getFolderHref(folder),
    }));
  };

  const buildMoveTargets = async (libraryRoot: LibraryFolderSummary) => {
    const folders = await (
      await resolveRepo()
    ).listFoldersByOwner(libraryRoot.ownerUserId, {
      includeDeleted: false,
    });
    const childrenByParent = new Map<string | null, LibraryFolderSummary[]>();

    for (const folder of folders) {
      const parentKey = folder.parentId;
      const siblings = childrenByParent.get(parentKey) ?? [];
      siblings.push(folder);
      childrenByParent.set(parentKey, siblings);
    }

    for (const siblings of childrenByParent.values()) {
      siblings.sort((left, right) => left.name.localeCompare(right.name));
    }

    const ordered: LibraryMoveTarget[] = [];
    const visited = new Set<string>();

    const visit = (folder: LibraryFolderSummary, pathNames: string[]) => {
      if (visited.has(folder.id)) {
        return;
      }

      visited.add(folder.id);
      ordered.push({
        id: folder.id,
        name: folder.name,
        pathLabel: pathNames.join(" / "),
        isLibraryRoot: folder.isLibraryRoot,
      });

      const children = childrenByParent.get(folder.id) ?? [];

      for (const child of children) {
        visit(child, [...pathNames, child.name]);
      }
    };

    visit(libraryRoot, [libraryRoot.name]);

    for (const folder of folders) {
      if (!visited.has(folder.id)) {
        visit(folder, [libraryRoot.name, folder.name]);
      }
    }

    return {
      childrenByParent,
      moveTargets: ordered,
    };
  };

  const getRestoreLocation = async (
    folder: LibraryFolderSummary,
    libraryRoot: LibraryFolderSummary,
  ): Promise<FolderRestoreLocation> => {
    const activeRepo = await resolveRepo();

    if (folder.parentId) {
      const parent = await activeRepo.findFolderById(folder.parentId);

      if (
        parent &&
        parent.ownerUserId === folder.ownerUserId &&
        parent.deletedAt === null
      ) {
        return {
          kind: "original-parent",
          folderId: parent.id,
          folderName: parent.name,
          pathLabel: parent.isLibraryRoot
            ? libraryRoot.name
            : buildFolderPathLabel({
                folder: parent,
                folderMap: new Map(
                  (
                    await activeRepo.listFoldersByOwner(folder.ownerUserId, {
                      includeDeleted: true,
                    })
                  ).map((candidate) => [candidate.id, candidate]),
                ),
                libraryRoot,
              }),
        };
      }
    }

    return {
      kind: "library-root",
      folderId: libraryRoot.id,
      folderName: libraryRoot.name,
      pathLabel: libraryRoot.name,
    };
  };

  const getFileRestoreLocation = async (
    file: StoredLibraryFile,
    libraryRoot: LibraryFolderSummary,
  ): Promise<FolderRestoreLocation> => {
    const activeRepo = await resolveRepo();

    if (file.folderId) {
      const parent = await activeRepo.findFolderById(file.folderId);

      if (
        parent &&
        parent.ownerUserId === file.ownerUserId &&
        parent.deletedAt === null
      ) {
        return {
          kind: "original-parent",
          folderId: parent.id,
          folderName: parent.name,
          pathLabel: parent.isLibraryRoot
            ? libraryRoot.name
            : buildFolderPathLabel({
                folder: parent,
                folderMap: new Map(
                  (
                    await activeRepo.listFoldersByOwner(file.ownerUserId, {
                      includeDeleted: true,
                    })
                  ).map((candidate) => [candidate.id, candidate]),
                ),
                libraryRoot,
              }),
        };
      }
    }

    return {
      kind: "library-root",
      folderId: libraryRoot.id,
      folderName: libraryRoot.name,
      pathLabel: libraryRoot.name,
    };
  };

  const findActiveNameConflict = async ({
    ownerUserId,
    parentId,
    name,
    excludeFolderId,
    excludeFileId,
  }: {
    ownerUserId: string;
    parentId: string;
    name: string;
    excludeFolderId?: string;
    excludeFileId?: string;
  }): Promise<ActiveNameConflict | null> => {
    const activeRepo = await resolveRepo();
    const [folders, files] = await Promise.all([
      activeRepo.listChildFolders(ownerUserId, parentId, {
        includeDeleted: false,
      }),
      activeRepo.listChildFiles(ownerUserId, parentId, {
        includeDeleted: false,
      }),
    ]);

    const conflictingFolder = folders.find(
      (folder) => folder.name === name && folder.id !== excludeFolderId,
    );

    if (conflictingFolder) {
      return {
        kind: "folder",
        item: conflictingFolder,
      };
    }

    const conflictingFile = files.find(
      (file) => file.name === name && file.id !== excludeFileId,
    );

    if (conflictingFile) {
      return {
        kind: "file",
        item: conflictingFile,
      };
    }

    return null;
  };

  const assertNoFolderNameConflict = async ({
    ownerUserId,
    parentId,
    name,
    excludeFolderId,
  }: {
    ownerUserId: string;
    parentId: string;
    name: string;
    excludeFolderId?: string;
  }) => {
    const conflict = await findActiveNameConflict({
      ownerUserId,
      parentId,
      name,
      excludeFolderId,
    });

    if (conflict) {
      throw new LibraryError("FOLDER_NAME_CONFLICT");
    }
  };

  const assertNoFileNameConflict = async ({
    ownerUserId,
    parentId,
    name,
    excludeFileId,
  }: {
    ownerUserId: string;
    parentId: string;
    name: string;
    excludeFileId?: string;
  }) => {
    const conflict = await findActiveNameConflict({
      ownerUserId,
      parentId,
      name,
      excludeFileId,
    });

    if (conflict) {
      throw new LibraryError("FILE_NAME_CONFLICT");
    }
  };

  const scheduleStagingCleanup = async (runAt = now()) => {
    if (scheduleStagingCleanupJob) {
      await scheduleStagingCleanupJob(runAt);
      return;
    }

    const {
      ensureBackgroundJobScheduled,
      STAGING_CLEANUP_JOB_KIND,
      STAGING_CLEANUP_SCHEDULE_WINDOW_MS,
    } = await import("@staaash/db/jobs");

    await ensureBackgroundJobScheduled({
      kind: STAGING_CLEANUP_JOB_KIND,
      runAt: new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
      payloadJson: {},
      windowEnd: new Date(runAt.getTime() + STAGING_CLEANUP_SCHEDULE_WINDOW_MS),
    });
  };

  return {
    async ensureLibraryRoot(ownerUserId: string) {
      return ensureLibraryRoot(ownerUserId);
    },

    async getLibraryListing({
      actorRole,
      actorUserId,
      folderId,
    }: LibraryActor & { folderId?: string | null }): Promise<LibraryListing> {
      const libraryRoot = await ensureLibraryRoot(actorUserId);
      const currentFolder = folderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId,
          })
        : libraryRoot;
      const activeRepo = await resolveRepo();
      const [childFolders, files] = await Promise.all([
        activeRepo.listChildFolders(currentFolder.ownerUserId, currentFolder.id, {
          includeDeleted: false,
        }),
        activeRepo.listChildFiles(currentFolder.ownerUserId, currentFolder.id, {
          includeDeleted: false,
        }),
      ]);
      const moveData = await buildMoveTargets(libraryRoot);
      const descendantIdsByFolderId = new Map<string, string[]>();
      const collectVisibleDescendantIds = (folderId: string): string[] => {
        const cached = descendantIdsByFolderId.get(folderId);

        if (cached) {
          return cached;
        }

        const children = moveData.childrenByParent.get(folderId) ?? [];
        const descendants = children.flatMap((child) => [
          child.id,
          ...collectVisibleDescendantIds(child.id),
        ]);
        descendantIdsByFolderId.set(folderId, descendants);

        return descendants;
      };
      const availableMoveTargetIdsByFolderId = Object.fromEntries(
        childFolders.map((folder) => {
          const blockedTargetIds = new Set([
            currentFolder.id,
            folder.id,
            ...collectVisibleDescendantIds(folder.id),
          ]);

          return [
            folder.id,
            moveData.moveTargets
              .filter((target) => !blockedTargetIds.has(target.id))
              .map((target) => target.id),
          ];
        }),
      );

      return {
        ownerUserId: currentFolder.ownerUserId,
        currentFolder,
        breadcrumbs: await buildBreadcrumbs(currentFolder, libraryRoot),
        childFolders,
        files: files.map(toLibraryFileSummary),
        moveTargets: moveData.moveTargets,
        availableMoveTargetIdsByFolderId,
      };
    },

    async listTrashFolders({
      actorRole,
      actorUserId,
    }: LibraryActor): Promise<TrashListing> {
      const libraryRoot = await ensureLibraryRoot(actorUserId);
      const activeRepo = await resolveRepo();
      const [allFolders, allFiles] = await Promise.all([
        activeRepo.listFoldersByOwner(libraryRoot.ownerUserId, {
          includeDeleted: true,
        }),
        activeRepo.listFilesByOwner(libraryRoot.ownerUserId, {
          includeDeleted: true,
        }),
      ]);
      const folderMap = new Map(
        allFolders.map((folder) => [folder.id, folder]),
      );
      const items: TrashFolderSummary[] = [];
      const files: TrashFileSummary[] = [];

      for (const folder of allFolders) {
        if (!folder.deletedAt || folder.isLibraryRoot) {
          continue;
        }

        const parent = folder.parentId ? folderMap.get(folder.parentId) : null;

        if (parent && parent.deletedAt) {
          continue;
        }

        assertFolderAccess(
          {
            actorRole,
            actorUserId,
          },
          folder,
        );

        items.push({
          folder,
          originalPathLabel: buildFolderPathLabel({
            folder,
            folderMap,
            libraryRoot,
          }),
          restoreLocation: await getRestoreLocation(folder, libraryRoot),
        });
      }

      for (const file of allFiles) {
        if (!file.deletedAt) {
          continue;
        }

        assertFileAccess(
          {
            actorRole,
            actorUserId,
          },
          file,
        );

        const fileSummary = toLibraryFileSummary(file);
        let ancestor = file.folderId ? folderMap.get(file.folderId) : null;
        let hasDeletedAncestor = false;

        while (ancestor) {
          if (ancestor.deletedAt) {
            hasDeletedAncestor = true;
            break;
          }

          ancestor = ancestor.parentId ? folderMap.get(ancestor.parentId) : null;
        }

        if (hasDeletedAncestor) {
          continue;
        }

        files.push({
          file: fileSummary,
          originalPathLabel: buildFilePathLabel({
            file: fileSummary,
            folderMap,
            libraryRoot,
          }),
          restoreLocation: await getFileRestoreLocation(file, libraryRoot),
        });
      }

      items.sort((left, right) => {
        const rightTime = right.folder.deletedAt?.getTime() ?? 0;
        const leftTime = left.folder.deletedAt?.getTime() ?? 0;

        return (
          rightTime - leftTime ||
          left.folder.name.localeCompare(right.folder.name)
        );
      });

      files.sort((left, right) => {
        const rightTime = right.file.deletedAt?.getTime() ?? 0;
        const leftTime = left.file.deletedAt?.getTime() ?? 0;

        return rightTime - leftTime || left.file.name.localeCompare(right.file.name);
      });

      return {
        libraryRoot,
        items,
        files,
      };
    },

    async createFolder({
      actorRole,
      actorUserId,
      parentId,
      name,
    }: CreateFolderInput): Promise<FolderMutationResult> {
      const normalizedName = normalizeFolderName(name);
      const parentFolder = parentId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId: parentId,
          })
        : await ensureLibraryRoot(actorUserId);

      await assertNoFolderNameConflict({
        ownerUserId: parentFolder.ownerUserId,
        parentId: parentFolder.id,
        name: normalizedName,
      });

      const folder = await (
        await resolveRepo()
      ).createFolder({
        ownerUserId: parentFolder.ownerUserId,
        parentId: parentFolder.id,
        name: normalizedName,
      });

      return {
        folder,
      };
    },

    async renameFolder({
      actorRole,
      actorUserId,
      folderId,
      name,
    }: RenameFolderInput): Promise<FolderMutationResult> {
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);
      const normalizedName = normalizeFolderName(name);
      const libraryRoot = await ensureLibraryRoot(folder.ownerUserId);

      await assertNoFolderNameConflict({
        ownerUserId: folder.ownerUserId,
        parentId: folder.parentId ?? libraryRoot.id,
        name: normalizedName,
        excludeFolderId: folder.id,
      });

      return {
        folder: await (
          await resolveRepo()
        ).updateFolder({
          id: folder.id,
          name: normalizedName,
        }),
      };
    },

    async moveFolder({
      actorRole,
      actorUserId,
      folderId,
      destinationFolderId,
    }: MoveFolderInput): Promise<FolderMutationResult> {
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);

      const destinationFolder = destinationFolderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId: destinationFolderId,
          })
        : await ensureLibraryRoot(actorUserId);

      if (destinationFolder.id === folder.id) {
        throw new LibraryError("FOLDER_MOVE_CYCLE");
      }

      if (destinationFolder.id === folder.parentId) {
        throw new LibraryError("FOLDER_MOVE_NOOP");
      }

      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
        includeDeleted: false,
      });

      if (
        descendants.some((descendant) => descendant.id === destinationFolder.id)
      ) {
        throw new LibraryError("FOLDER_MOVE_CYCLE");
      }

      await assertNoFolderNameConflict({
        ownerUserId: folder.ownerUserId,
        parentId: destinationFolder.id,
        name: folder.name,
        excludeFolderId: folder.id,
      });

      return {
        folder: await (
          await resolveRepo()
        ).updateFolder({
          id: folder.id,
          parentId: destinationFolder.id,
        }),
      };
    },

    async trashFolder({
      actorRole,
      actorUserId,
      folderId,
    }: FolderLookupInput): Promise<FolderMutationResult> {
      const folder = await getActiveOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);

      const deletedAt = now();
      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
      });
      const folderIds = new Set([
        folder.id,
        ...descendants.map((descendant) => descendant.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
      });
      const activeRepo = await resolveRepo();

      await activeRepo.updateFolders({
        ids: Array.from(folderIds),
        deletedAt,
      });
      await activeRepo.updateFiles({
        ids: descendantFiles.map((file) => file.id),
        deletedAt,
      });

      return {
        folder: assertFolderAccess(
          {
            actorRole,
            actorUserId,
          },
          await activeRepo.findFolderById(folder.id),
        ),
      };
    },

    async restoreFolder({
      actorRole,
      actorUserId,
      folderId,
    }: FolderLookupInput): Promise<FolderMutationResult> {
      const folder = await getOwnedFolder({
        actorRole,
        actorUserId,
        folderId,
      });
      assertMutableFolder(folder);

      if (!folder.deletedAt) {
        throw new LibraryError("FOLDER_ALREADY_ACTIVE");
      }

      const libraryRoot = await ensureLibraryRoot(folder.ownerUserId);
      const restoreLocation = await getRestoreLocation(folder, libraryRoot);
      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
      });
      const folderIds = new Set([
        folder.id,
        ...descendants.map((descendant) => descendant.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
      });
      const activeRepo = await resolveRepo();

      await activeRepo.updateFolders({
        ids: Array.from(folderIds),
        deletedAt: null,
      });
      await activeRepo.updateFiles({
        ids: descendantFiles.map((file) => file.id),
        deletedAt: null,
      });

      const restoredFolder = await activeRepo.updateFolder({
        id: folder.id,
        parentId: restoreLocation.folderId,
      });

      return {
        folder: restoredFolder,
        restoredTo: restoreLocation,
      };
    },

    async renameFile({
      actorRole,
      actorUserId,
      fileId,
      name,
    }: RenameFileInput): Promise<FileMutationResult> {
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });
      const normalizedName = normalizeFileName(name);
      const libraryRoot = await ensureLibraryRoot(file.ownerUserId);
      const parentId = file.folderId ?? libraryRoot.id;

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId,
        name: normalizedName,
        excludeFileId: file.id,
      });

      const updated = await (await resolveRepo()).updateFile({
        id: file.id,
        name: normalizedName,
      });

      return {
        file: toLibraryFileSummary(updated),
      };
    },

    async moveFile({
      actorRole,
      actorUserId,
      fileId,
      destinationFolderId,
    }: MoveFileInput): Promise<FileMutationResult> {
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      const destinationFolder = destinationFolderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId: destinationFolderId,
          })
        : await ensureLibraryRoot(actorUserId);

      if (destinationFolder.id === file.folderId) {
        throw new LibraryError("FILE_MOVE_NOOP");
      }

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId: destinationFolder.id,
        name: file.name,
        excludeFileId: file.id,
      });

      const updated = await (await resolveRepo()).updateFile({
        id: file.id,
        folderId: destinationFolder.id,
      });

      return {
        file: toLibraryFileSummary(updated),
      };
    },

    async trashFile({
      actorRole,
      actorUserId,
      fileId,
    }: FileLookupInput): Promise<FileMutationResult> {
      const file = await getActiveOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      const updated = await (await resolveRepo()).updateFile({
        id: file.id,
        deletedAt: now(),
      });

      return {
        file: toLibraryFileSummary(updated),
      };
    },

    async restoreFile({
      actorRole,
      actorUserId,
      fileId,
    }: FileLookupInput): Promise<FileMutationResult> {
      const file = await getOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      if (!file.deletedAt) {
        throw new LibraryError("FILE_ALREADY_ACTIVE");
      }

      const libraryRoot = await ensureLibraryRoot(file.ownerUserId);
      const restoreLocation = await getFileRestoreLocation(file, libraryRoot);

      await assertNoFileNameConflict({
        ownerUserId: file.ownerUserId,
        parentId: restoreLocation.folderId,
        name: file.name,
        excludeFileId: file.id,
      });

      const updated = await (await resolveRepo()).updateFile({
        id: file.id,
        deletedAt: null,
        folderId: restoreLocation.folderId,
      });

      return {
        file: toLibraryFileSummary(updated),
        restoredTo: restoreLocation,
      };
    },

    async deleteFile({
      actorRole,
      actorUserId,
      fileId,
    }: FileLookupInput): Promise<FileMutationResult> {
      const file = await getOwnedFile({
        actorRole,
        actorUserId,
        fileId,
      });

      if (!file.deletedAt) {
        throw new LibraryError("FILE_DELETE_REQUIRES_TRASH");
      }

      await rm(getStoragePath(file.storageKey), {
        force: true,
      });
      await (await resolveRepo()).deleteFile(file.id);

      return {
        deletedFileId: file.id,
      };
    },

    async uploadFiles({
      actorRole,
      actorUserId,
      folderId,
      items,
    }: UploadFilesInput): Promise<UploadFilesResult> {
      const targetFolder = folderId
        ? await getActiveOwnedFolder({
            actorRole,
            actorUserId,
            folderId,
          })
        : await ensureLibraryRoot(actorUserId);
      const activeRepo = await resolveRepo();
      const uploadedFiles: LibraryFileSummary[] = [];
      const conflicts: UploadConflictItem[] = [];
      let stagedAnyUpload = false;

      for (const item of items) {
        const normalizedName = normalizeFileName(item.originalName || item.file.name);
        const stagedFile = await stageUpload({
          ...item,
          originalName: normalizedName,
        });
        stagedAnyUpload = true;

        const activeConflict = await findActiveNameConflict({
          ownerUserId: targetFolder.ownerUserId,
          parentId: targetFolder.id,
          name: normalizedName,
        });

        let finalName = normalizedName;

        if (activeConflict) {
          if (item.conflictStrategy === "replace" && activeConflict.kind === "file") {
            const updated = await replaceCommittedUpload({
              stagedFile,
              targetPath: getStoragePath(activeConflict.item.storageKey),
              applyMetadataUpdate: () =>
                activeRepo.updateFile({
                  id: activeConflict.item.id,
                  name: activeConflict.item.name,
                  mimeType: stagedFile.mimeType,
                  sizeBytes: stagedFile.sizeBytes,
                  contentChecksum: stagedFile.actualChecksum,
                  deletedAt: null,
                  folderId: targetFolder.id,
                }),
            });

            uploadedFiles.push(toLibraryFileSummary(updated));
            continue;
          }

          if (item.conflictStrategy === "safeRename") {
            const siblings = await Promise.all([
              activeRepo.listChildFolders(targetFolder.ownerUserId, targetFolder.id, {
                includeDeleted: false,
              }),
              activeRepo.listChildFiles(targetFolder.ownerUserId, targetFolder.id, {
                includeDeleted: false,
              }),
            ]);
            finalName = buildSafeRenamedFileName(normalizedName, [
              ...siblings[0].map((folder) => folder.name),
              ...siblings[1].map((file) => file.name),
            ]);
          } else {
            conflicts.push({
              clientKey: item.clientKey,
              originalName: normalizedName,
              conflictStrategy: item.conflictStrategy,
              existingKind: activeConflict.kind,
              existingId: activeConflict.item.id,
              existingName: activeConflict.item.name,
            });
            await cleanupStagedUpload(stagedFile.tmpPath);
            continue;
          }
        }

        const fileId = randomUUID();
        const storedFileRef = buildStoredFileRef(targetFolder.ownerUserId, fileId);
        const targetPath = getStoragePath(storedFileRef.storageKey);

        try {
          await commitStagedUpload(stagedFile, targetPath);
        } catch (error) {
          await cleanupStagedUpload(stagedFile.tmpPath);
          throw error;
        }

        try {
          const createdFile = await activeRepo.createFile({
            id: fileId,
            ownerUserId: targetFolder.ownerUserId,
            folderId: targetFolder.id,
            name: finalName,
            storageKey: storedFileRef.storageKey,
            mimeType: stagedFile.mimeType,
            sizeBytes: stagedFile.sizeBytes,
            contentChecksum: stagedFile.actualChecksum,
          });

          uploadedFiles.push(toLibraryFileSummary(createdFile));
        } catch (error) {
          await rm(targetPath, {
            force: true,
          });
          throw error;
        }
      }

      if (stagedAnyUpload) {
        await scheduleStagingCleanup();
      }

      return {
        uploadedFiles,
        conflicts,
      };
    },
  };
};

export const libraryService = createLibraryService();
