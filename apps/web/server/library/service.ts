import { canAccessPrivateNamespace } from "@/server/access";
import { LibraryError } from "@/server/library/errors";
import type {
  FolderMutationResult,
  FolderRestoreLocation,
  LibraryActor,
  LibraryBreadcrumb,
  LibraryFolderSummary,
  LibraryListing,
  LibraryMoveTarget,
  TrashListing,
  TrashFolderSummary,
} from "@/server/library/types";

import type { LibraryRepository } from "./repository";

type CreateLibraryServiceOptions = {
  repo?: LibraryRepository;
  now?: () => Date;
};

type FolderLookupInput = LibraryActor & {
  folderId: string;
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

const assertActiveFolder = (folder: LibraryFolderSummary) => {
  if (folder.deletedAt) {
    throw new LibraryError("FOLDER_NOT_FOUND");
  }

  return folder;
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

export const createLibraryService = ({
  repo,
  now = () => new Date(),
}: CreateLibraryServiceOptions = {}) => {
  const resolveRepo = async (): Promise<LibraryRepository> =>
    repo ?? (await import("./repository")).prismaLibraryRepository;

  const ensureLibraryRoot = async (ownerUserId: string) => {
    const activeRepo = await resolveRepo();
    return (
      (await activeRepo.findLibraryRootByOwnerUserId(ownerUserId)) ??
      activeRepo.createLibraryRoot(ownerUserId)
    );
  };

  const getOwnedFolder = async ({
    actorRole,
    actorUserId,
    folderId,
  }: FolderLookupInput) => {
    const folder = assertFolderAccess(
      {
        actorRole,
        actorUserId,
      },
      await (await resolveRepo()).findFolderById(folderId),
    );

    return folder;
  };

  const getActiveOwnedFolder = async (input: FolderLookupInput) =>
    assertActiveFolder(await getOwnedFolder(input));

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
      const childFolders = await activeRepo.listChildFolders(
        currentFolder.ownerUserId,
        currentFolder.id,
        {
          includeDeleted: false,
        },
      );
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
        moveTargets: moveData.moveTargets,
        availableMoveTargetIdsByFolderId,
      };
    },

    async listTrashFolders({
      actorRole,
      actorUserId,
    }: LibraryActor): Promise<TrashListing> {
      const libraryRoot = await ensureLibraryRoot(actorUserId);
      const allFolders = await (
        await resolveRepo()
      ).listFoldersByOwner(libraryRoot.ownerUserId, {
        includeDeleted: true,
      });
      const folderMap = new Map(
        allFolders.map((folder) => [folder.id, folder]),
      );
      const items: TrashFolderSummary[] = [];

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

      items.sort((left, right) => {
        const rightTime = right.folder.deletedAt?.getTime() ?? 0;
        const leftTime = left.folder.deletedAt?.getTime() ?? 0;

        return (
          rightTime - leftTime ||
          left.folder.name.localeCompare(right.folder.name)
        );
      });

      return {
        libraryRoot,
        items,
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

      return {
        folder: await (
          await resolveRepo()
        ).updateFolder({
          id: folder.id,
          name: normalizeFolderName(name),
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
      const activeRepo = await resolveRepo();

      await activeRepo.updateFolders({
        ids: [folder.id, ...descendants.map((descendant) => descendant.id)],
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
      const activeRepo = await resolveRepo();

      await activeRepo.updateFolders({
        ids: [folder.id, ...descendants.map((descendant) => descendant.id)],
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
  };
};

export const libraryService = createLibraryService();
