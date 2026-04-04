import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";

import { canAccessPrivateNamespace } from "@/server/access";
import { LibraryError } from "@/server/library/errors";
import {
  buildFileStorageKey,
  buildFolderStorageKey,
  normalizeFileName,
  normalizeFolderName,
} from "@/server/library/storage-layout";
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
  TrashClearResult,
  TrashFileSummary,
  TrashFolderSummary,
  TrashListing,
} from "@/server/library/types";
import {
  ensureUserCommittedStorageDirectories,
  getStoragePath,
} from "@/server/storage";
import {
  finalizePendingDelete,
  getDirectoryMutationLockKey,
  getEntryMutationLockKey,
  moveStorageEntryWithLock,
  quarantineDeleteWithLock,
  rollbackPendingDelete,
  withStorageLocks,
} from "@/server/storage-mutations";
import {
  buildSafeRenamedFileName,
  createUploadDeadline,
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

const toLibraryFileSummary = (
  file: Pick<
    StoredLibraryFile,
    | "id"
    | "ownerUserId"
    | "ownerUsername"
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
  ownerUsername: file.ownerUsername,
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

const assertFileAccess = (
  actor: LibraryActor,
  file: StoredLibraryFile | null,
) => {
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

const buildFolderMap = (folders: LibraryFolderSummary[]) =>
  new Map(folders.map((folder) => [folder.id, folder]));

const cloneFolderMap = (folderMap: Map<string, LibraryFolderSummary>) =>
  new Map(
    Array.from(folderMap.entries()).map(([id, folder]) => [id, { ...folder }]),
  );

const buildUpdatedFolderMap = ({
  folderMap,
  updatedFolders,
}: {
  folderMap: Map<string, LibraryFolderSummary>;
  updatedFolders: LibraryFolderSummary[];
}) => {
  const next = cloneFolderMap(folderMap);

  for (const folder of updatedFolders) {
    next.set(folder.id, folder);
  }

  return next;
};

const createFolderDirectory = async (storageKey: string) => {
  await mkdir(getStoragePath(storageKey), {
    recursive: true,
  });
};

const removeFolderDirectory = async (storageKey: string) => {
  await rm(getStoragePath(storageKey), {
    recursive: true,
    force: true,
  });
};

const moveStorageEntry = async ({
  fromStorageKey,
  toStorageKey,
}: {
  fromStorageKey: string;
  toStorageKey: string;
}) => {
  if (fromStorageKey === toStorageKey) {
    return;
  }

  const fromPath = getStoragePath(fromStorageKey);
  const toPath = getStoragePath(toStorageKey);

  await moveStorageEntryWithLock({
    fromPath,
    toPath,
    lockKeys: [
      getEntryMutationLockKey(fromPath),
      getDirectoryMutationLockKey(fromPath),
      getDirectoryMutationLockKey(toPath),
    ],
  });
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
    const libraryRoot = await activeRepo.ensureLibraryRoot(ownerUserId);
    await ensureUserCommittedStorageDirectories(libraryRoot.ownerUsername);
    await createFolderDirectory(
      buildFolderStorageKey({
        folder: libraryRoot,
        folderMap: new Map([[libraryRoot.id, libraryRoot]]),
        libraryRoot,
        trashed: false,
      }),
    );

    return libraryRoot;
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
    const files = await (
      await resolveRepo()
    ).listFilesByOwner(ownerUserId, {
      includeDeleted,
    });

    return files.filter(
      (file) => file.folderId && folderIds.has(file.folderId),
    );
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

  const deleteTrashedFolderTree = async ({
    folder,
    libraryRoot,
  }: {
    folder: LibraryFolderSummary;
    libraryRoot: LibraryFolderSummary;
  }): Promise<{ deletedFolderCount: number; deletedFileCount: number }> => {
    const activeRepo = await resolveRepo();
    const allFoldersForKey = buildFolderMap(
      await activeRepo.listFoldersByOwner(folder.ownerUserId, {
        includeDeleted: true,
      }),
    );
    const trashedStorageKey = buildFolderStorageKey({
      folder,
      folderMap: allFoldersForKey,
      libraryRoot,
      trashed: true,
    });
    const trashedStoragePath = getStoragePath(trashedStorageKey);
    const lockKeys = [
      getEntryMutationLockKey(trashedStoragePath),
      getDirectoryMutationLockKey(trashedStoragePath),
    ];

    return withStorageLocks({
      lockKeys,
      callback: async () => {
        // Re-fetch to verify the root is still trashed after acquiring locks.
        const currentFolder = await activeRepo.findFolderById(folder.id);

        if (!currentFolder || currentFolder.deletedAt === null) {
          // Concurrently restored — skip.
          return { deletedFolderCount: 0, deletedFileCount: 0 };
        }

        // Re-collect from live state after revalidation.
        const descendants = await collectDescendants({
          ownerUserId: currentFolder.ownerUserId,
          folderId: currentFolder.id,
        });
        const folderIds = new Set([
          currentFolder.id,
          ...descendants.map((item) => item.id),
        ]);
        const descendantFiles = await collectFilesInFolders({
          ownerUserId: currentFolder.ownerUserId,
          folderIds,
        });

        // Delete only rows that are still present/trashed.
        const trashedDescendantIds = descendants
          .filter((d) => d.deletedAt !== null)
          .map((d) => d.id);
        const deletedFileCount = await activeRepo.deleteFiles(
          descendantFiles.map((file) => file.id),
        );
        await activeRepo.deleteFolders(trashedDescendantIds);
        await activeRepo.deleteFolders([currentFolder.id]);

        // Best-effort remove the trashed directory after DB deletion.
        try {
          await removeFolderDirectory(trashedStorageKey);
        } catch {
          // Once the tree rows are gone, leftover trash storage is operational
          // residue. Best-effort cleanup avoids reintroducing deleted records.
        }

        return {
          deletedFolderCount: 1 + trashedDescendantIds.length,
          deletedFileCount,
        };
      },
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
        activeRepo.listChildFolders(
          currentFolder.ownerUserId,
          currentFolder.id,
          {
            includeDeleted: false,
          },
        ),
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

          ancestor = ancestor.parentId
            ? folderMap.get(ancestor.parentId)
            : null;
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

        return (
          rightTime - leftTime || left.file.name.localeCompare(right.file.name)
        );
      });

      return {
        libraryRoot,
        items,
        files,
      };
    },

    async clearTrash({
      actorRole,
      actorUserId,
    }: LibraryActor): Promise<TrashClearResult> {
      const listing = await this.listTrashFolders({
        actorRole,
        actorUserId,
      });

      let deletedFolderCount = 0;
      let deletedFileCount = 0;

      for (const item of listing.files) {
        await this.deleteFile({
          actorRole,
          actorUserId,
          fileId: item.file.id,
        });
        deletedFileCount += 1;
      }

      for (const item of listing.items) {
        const counts = await deleteTrashedFolderTree({
          folder: item.folder,
          libraryRoot: listing.libraryRoot,
        });
        deletedFolderCount += counts.deletedFolderCount;
        deletedFileCount += counts.deletedFileCount;
      }

      return {
        deletedFolderCount,
        deletedFileCount,
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
      const activeRepo = await resolveRepo();
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(parentFolder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const virtualFolder: LibraryFolderSummary = {
        id: `pending-${randomUUID()}`,
        ownerUserId: parentFolder.ownerUserId,
        ownerUsername: parentFolder.ownerUsername,
        parentId: parentFolder.id,
        name: normalizedName,
        isLibraryRoot: false,
        deletedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      const folderStorageKey = buildFolderStorageKey({
        folder: virtualFolder,
        folderMap: new Map(folderMap).set(virtualFolder.id, virtualFolder),
        libraryRoot: await ensureLibraryRoot(parentFolder.ownerUserId),
        trashed: false,
      });

      await createFolderDirectory(folderStorageKey);

      try {
        const folder = await activeRepo.createFolder({
          ownerUserId: parentFolder.ownerUserId,
          parentId: parentFolder.id,
          name: normalizedName,
        });

        return {
          folder,
        };
      } catch (error) {
        await removeFolderDirectory(folderStorageKey);
        throw error;
      }
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
      const activeRepo = await resolveRepo();
      const descendants = await collectDescendants({
        ownerUserId: folder.ownerUserId,
        folderId: folder.id,
        includeDeleted: true,
      });
      const folderIds = new Set([
        folder.id,
        ...descendants.map((item) => item.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
        includeDeleted: true,
      });
      const currentFolderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextFolder = {
        ...folder,
        name: normalizedName,
      };
      const nextFolderMap = buildUpdatedFolderMap({
        folderMap: currentFolderMap,
        updatedFolders: [nextFolder],
      });
      const previousFileStates: Array<
        Pick<StoredLibraryFile, "id" | "storageKey">
      > = [];
      const fromStorageKey = buildFolderStorageKey({
        folder,
        folderMap: currentFolderMap,
        libraryRoot,
        trashed: false,
      });
      const toStorageKey = buildFolderStorageKey({
        folder: nextFolder,
        folderMap: nextFolderMap,
        libraryRoot,
        trashed: false,
      });

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        const updatedFolder = await activeRepo.updateFolder({
          id: folder.id,
          name: normalizedName,
        });

        for (const descendantFile of descendantFiles) {
          const nextStorageKey = buildFileStorageKey({
            file: descendantFile,
            folderMap: nextFolderMap,
            libraryRoot,
            trashed: false,
          });

          if (nextStorageKey === descendantFile.storageKey) {
            continue;
          }

          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            storageKey: nextStorageKey,
          });
        }

        return {
          folder: updatedFolder,
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolder({
          id: folder.id,
          name: folder.name,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
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
      const activeRepo = await resolveRepo();
      const libraryRoot = await ensureLibraryRoot(folder.ownerUserId);
      const folderIds = new Set([
        folder.id,
        ...descendants.map((item) => item.id),
      ]);
      const descendantFiles = await collectFilesInFolders({
        ownerUserId: folder.ownerUserId,
        folderIds,
        includeDeleted: true,
      });
      const currentFolderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextFolder = {
        ...folder,
        parentId: destinationFolder.id,
      };
      const nextFolderMap = buildUpdatedFolderMap({
        folderMap: currentFolderMap,
        updatedFolders: [nextFolder],
      });
      const previousFileStates: Array<
        Pick<StoredLibraryFile, "id" | "storageKey">
      > = [];
      const fromStorageKey = buildFolderStorageKey({
        folder,
        folderMap: currentFolderMap,
        libraryRoot,
        trashed: false,
      });
      const toStorageKey = buildFolderStorageKey({
        folder: nextFolder,
        folderMap: nextFolderMap,
        libraryRoot,
        trashed: false,
      });

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        const updatedFolder = await activeRepo.updateFolder({
          id: folder.id,
          parentId: destinationFolder.id,
        });

        for (const descendantFile of descendantFiles) {
          const nextStorageKey = buildFileStorageKey({
            file: descendantFile,
            folderMap: nextFolderMap,
            libraryRoot,
            trashed: false,
          });

          if (nextStorageKey === descendantFile.storageKey) {
            continue;
          }

          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            storageKey: nextStorageKey,
          });
        }

        return {
          folder: updatedFolder,
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolder({
          id: folder.id,
          parentId: folder.parentId,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
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
      const libraryRoot = await ensureLibraryRoot(folder.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const previousFileStates: Array<
        Pick<StoredLibraryFile, "id" | "storageKey" | "deletedAt">
      > = [];
      const fromStorageKey = buildFolderStorageKey({
        folder,
        folderMap,
        libraryRoot,
        trashed: false,
      });
      const toStorageKey = buildFolderStorageKey({
        folder,
        folderMap,
        libraryRoot,
        trashed: true,
      });

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        await activeRepo.updateFolders({
          ids: Array.from(folderIds),
          deletedAt,
        });

        for (const descendantFile of descendantFiles) {
          const trashedStorageKey = buildFileStorageKey({
            file: descendantFile,
            folderMap,
            libraryRoot,
            trashed: true,
          });
          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
            deletedAt: descendantFile.deletedAt,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            deletedAt,
            storageKey: trashedStorageKey,
          });
        }

        return {
          folder: assertFolderAccess(
            {
              actorRole,
              actorUserId,
            },
            await activeRepo.findFolderById(folder.id),
          ),
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            deletedAt: previousFileState.deletedAt,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolders({
          ids: Array.from(folderIds),
          deletedAt: null,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
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
      const currentFolderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(folder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextFolder = {
        ...folder,
        parentId: restoreLocation.folderId,
        deletedAt: null,
      };
      const nextFolderMap = buildUpdatedFolderMap({
        folderMap: currentFolderMap,
        updatedFolders: [nextFolder],
      });
      const previousFileStates: Array<
        Pick<StoredLibraryFile, "id" | "storageKey" | "deletedAt">
      > = [];
      const fromStorageKey = buildFolderStorageKey({
        folder,
        folderMap: currentFolderMap,
        libraryRoot,
        trashed: true,
      });
      const toStorageKey = buildFolderStorageKey({
        folder: nextFolder,
        folderMap: nextFolderMap,
        libraryRoot,
        trashed: false,
      });

      await moveStorageEntry({
        fromStorageKey,
        toStorageKey,
      });

      try {
        await activeRepo.updateFolders({
          ids: descendants.map((descendant) => descendant.id),
          deletedAt: null,
        });

        const restoredFolder = await activeRepo.updateFolder({
          id: folder.id,
          parentId: restoreLocation.folderId,
          deletedAt: null,
        });

        for (const descendantFile of descendantFiles) {
          const restoredStorageKey = buildFileStorageKey({
            file: {
              ownerUsername: descendantFile.ownerUsername,
              folderId: descendantFile.folderId,
              name: descendantFile.name,
            },
            folderMap: nextFolderMap,
            libraryRoot,
            trashed: false,
          });
          previousFileStates.push({
            id: descendantFile.id,
            storageKey: descendantFile.storageKey,
            deletedAt: descendantFile.deletedAt,
          });
          await activeRepo.updateFile({
            id: descendantFile.id,
            deletedAt: null,
            storageKey: restoredStorageKey,
          });
        }

        return {
          folder: restoredFolder,
          restoredTo: restoreLocation,
        };
      } catch (error) {
        for (const previousFileState of previousFileStates.reverse()) {
          await activeRepo.updateFile({
            id: previousFileState.id,
            deletedAt: previousFileState.deletedAt,
            storageKey: previousFileState.storageKey,
          });
        }

        await activeRepo.updateFolders({
          ids: descendants.map((descendant) => descendant.id),
          deletedAt: folder.deletedAt,
        });
        await activeRepo.updateFolder({
          id: folder.id,
          parentId: folder.parentId,
          deletedAt: folder.deletedAt,
        });
        await moveStorageEntry({
          fromStorageKey: toStorageKey,
          toStorageKey: fromStorageKey,
        });
        throw error;
      }
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
      const activeRepo = await resolveRepo();
      const allFolders = await activeRepo.listFoldersByOwner(file.ownerUserId, {
        includeDeleted: true,
      });
      const folderMap = buildFolderMap(allFolders);
      const nextFile = {
        ...file,
        name: normalizedName,
      };
      const nextStorageKey = buildFileStorageKey({
        file: nextFile,
        folderMap,
        libraryRoot,
        trashed: false,
      });

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: nextStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          name: normalizedName,
          storageKey: nextStorageKey,
        });

        return {
          file: toLibraryFileSummary(updated),
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: nextStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
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
      const activeRepo = await resolveRepo();
      const libraryRoot = await ensureLibraryRoot(file.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(file.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const nextStorageKey = buildFileStorageKey({
        file: {
          ...file,
          folderId: destinationFolder.id,
        },
        folderMap,
        libraryRoot,
        trashed: false,
      });

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: nextStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          folderId: destinationFolder.id,
          storageKey: nextStorageKey,
        });

        return {
          file: toLibraryFileSummary(updated),
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: nextStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
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
      const activeRepo = await resolveRepo();
      const libraryRoot = await ensureLibraryRoot(file.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(file.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const trashedStorageKey = buildFileStorageKey({
        file,
        folderMap,
        libraryRoot,
        trashed: true,
      });

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: trashedStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          deletedAt: now(),
          storageKey: trashedStorageKey,
        });

        return {
          file: toLibraryFileSummary(updated),
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: trashedStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
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
      const activeRepo = await resolveRepo();
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(file.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const restoredStorageKey = buildFileStorageKey({
        file: {
          ...file,
          folderId: restoreLocation.folderId,
        },
        folderMap,
        libraryRoot,
        trashed: false,
      });

      await moveStorageEntry({
        fromStorageKey: file.storageKey,
        toStorageKey: restoredStorageKey,
      });

      try {
        const updated = await activeRepo.updateFile({
          id: file.id,
          deletedAt: null,
          folderId: restoreLocation.folderId,
          storageKey: restoredStorageKey,
        });

        return {
          file: toLibraryFileSummary(updated),
          restoredTo: restoreLocation,
        };
      } catch (error) {
        await moveStorageEntry({
          fromStorageKey: restoredStorageKey,
          toStorageKey: file.storageKey,
        });
        throw error;
      }
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

      const activeRepo = await resolveRepo();
      const filePath = getStoragePath(file.storageKey);
      const lockKeys = [
        getEntryMutationLockKey(filePath),
        getDirectoryMutationLockKey(filePath),
      ];

      await withStorageLocks({
        lockKeys,
        callback: async () => {
          const pendingDelete = await quarantineDeleteWithLock({
            fileId: file.id,
            originalStorageKey: file.storageKey,
            originalPath: filePath,
            lockKeys: [],
          });

          try {
            await activeRepo.deleteFile(file.id);
          } catch (error) {
            try {
              await rollbackPendingDelete(pendingDelete);
            } catch {
              // Preserve the original repository failure. Pending delete
              // recovery will reconcile any leftover quarantine state.
            }

            throw error;
          }

          try {
            await finalizePendingDelete(pendingDelete);
          } catch {
            // The delete is logically complete once the database row is gone.
            // Worker recovery handles any leftover quarantine files.
          }
        },
      });

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
      const libraryRoot = await ensureLibraryRoot(targetFolder.ownerUserId);
      const folderMap = buildFolderMap(
        await activeRepo.listFoldersByOwner(targetFolder.ownerUserId, {
          includeDeleted: true,
        }),
      );
      const uploadDeadline = createUploadDeadline(now().getTime());
      const targetFolderPath = getStoragePath(
        buildFolderStorageKey({
          folder: targetFolder,
          folderMap,
          libraryRoot,
          trashed: false,
        }),
      );
      const targetFolderLockKeys = [
        getEntryMutationLockKey(targetFolderPath),
        getDirectoryMutationLockKey(targetFolderPath),
      ];
      const uploadedFiles: LibraryFileSummary[] = [];
      const conflicts: UploadConflictItem[] = [];
      let stagedAnyUpload = false;

      for (const item of items) {
        const normalizedName = normalizeFileName(
          item.originalName || item.file.name,
        );
        const stagedFile = await stageUpload(
          {
            ...item,
            originalName: normalizedName,
          },
          uploadDeadline,
        );
        stagedAnyUpload = true;

        try {
          await withStorageLocks({
            lockKeys: targetFolderLockKeys,
            deadline: uploadDeadline,
            callback: async () => {
              const activeConflict = await findActiveNameConflict({
                ownerUserId: targetFolder.ownerUserId,
                parentId: targetFolder.id,
                name: normalizedName,
              });

              let finalName = normalizedName;

              if (activeConflict) {
                if (
                  item.conflictStrategy === "replace" &&
                  activeConflict.kind === "file"
                ) {
                  const updated = await replaceCommittedUpload({
                    stagedFile,
                    targetPath: getStoragePath(activeConflict.item.storageKey),
                    deadline: uploadDeadline,
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
                  return;
                }

                if (item.conflictStrategy === "safeRename") {
                  const siblings = await Promise.all([
                    activeRepo.listChildFolders(
                      targetFolder.ownerUserId,
                      targetFolder.id,
                      {
                        includeDeleted: false,
                      },
                    ),
                    activeRepo.listChildFiles(
                      targetFolder.ownerUserId,
                      targetFolder.id,
                      {
                        includeDeleted: false,
                      },
                    ),
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
                  return;
                }
              }

              const storageKey = buildFileStorageKey({
                file: {
                  ownerUsername: targetFolder.ownerUsername,
                  folderId: targetFolder.id,
                  name: finalName,
                },
                folderMap,
                libraryRoot,
                trashed: false,
              });
              const fileId = randomUUID();
              const targetPath = getStoragePath(storageKey);

              try {
                await commitStagedUpload(stagedFile, targetPath, {
                  deadline: uploadDeadline,
                });
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
                  storageKey,
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
            },
          });
        } catch (error) {
          await cleanupStagedUpload(stagedFile.tmpPath);

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
