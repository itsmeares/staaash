import type { UserRole } from "@/server/types";

export type LibraryActor = {
  actorUserId: string;
  actorRole: UserRole;
};

export type LibraryFolderSummary = {
  id: string;
  ownerUserId: string;
  parentId: string | null;
  name: string;
  isLibraryRoot: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LibraryBreadcrumb = {
  id: string;
  name: string;
  href: string;
};

export type LibraryMoveTarget = {
  id: string;
  name: string;
  pathLabel: string;
  isLibraryRoot: boolean;
};

export type LibraryListing = {
  ownerUserId: string;
  currentFolder: LibraryFolderSummary;
  breadcrumbs: LibraryBreadcrumb[];
  childFolders: LibraryFolderSummary[];
  moveTargets: LibraryMoveTarget[];
  availableMoveTargetIdsByFolderId: Record<string, string[]>;
};

export type FolderRestoreLocation = {
  kind: "original-parent" | "library-root";
  folderId: string;
  folderName: string;
  pathLabel: string;
};

export type FolderMutationResult = {
  folder: LibraryFolderSummary;
  restoredTo?: FolderRestoreLocation;
};

export type TrashFolderSummary = {
  folder: LibraryFolderSummary;
  originalPathLabel: string;
  restoreLocation: FolderRestoreLocation;
};

export type TrashListing = {
  libraryRoot: LibraryFolderSummary;
  items: TrashFolderSummary[];
};
