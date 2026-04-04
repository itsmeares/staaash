import type { UserRole } from "@/server/types";

export type LibraryActor = {
  actorUserId: string;
  actorRole: UserRole;
};

export type LibraryFolderSummary = {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  parentId: string | null;
  name: string;
  isLibraryRoot: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PreviewKind = "image" | "pdf" | "text" | "audio" | "video";

export type LibraryFileSummary = {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  previewStatus: "pending" | "ready" | "failed";
  previewKind: PreviewKind | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredLibraryFile = LibraryFileSummary & {
  storageKey: string;
  contentChecksum: string | null;
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
  files: LibraryFileSummary[];
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

export type FileMutationResult = {
  file?: LibraryFileSummary;
  deletedFileId?: string;
  restoredTo?: FolderRestoreLocation;
};

export type TrashFolderSummary = {
  folder: LibraryFolderSummary;
  originalPathLabel: string;
  restoreLocation: FolderRestoreLocation;
};

export type TrashFileSummary = {
  file: LibraryFileSummary;
  originalPathLabel: string;
  restoreLocation: FolderRestoreLocation;
};

export type TrashListing = {
  libraryRoot: LibraryFolderSummary;
  items: TrashFolderSummary[];
  files: TrashFileSummary[];
};

export type TrashClearResult = {
  deletedFolderCount: number;
  deletedFileCount: number;
};
