import type { UserRole } from "@/server/types";
import type { ViewerKind } from "@staaash/db/viewer-contract";

export type FilesActor = {
  actorUserId: string;
  actorRole: UserRole;
};

export type FolderSummary = {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  parentId: string | null;
  name: string;
  isFilesRoot: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FileSummary = {
  id: string;
  ownerUserId: string;
  ownerUsername: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  viewerKind: ViewerKind | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredFile = FileSummary & {
  storageKey: string;
  contentChecksum: string | null;
};

export type FilesBreadcrumb = {
  id: string;
  name: string;
  href: string;
};

export type MoveTarget = {
  id: string;
  name: string;
  pathLabel: string;
  isFilesRoot: boolean;
};

export type FilesListing = {
  ownerUserId: string;
  currentFolder: FolderSummary;
  breadcrumbs: FilesBreadcrumb[];
  childFolders: FolderSummary[];
  files: FileSummary[];
  moveTargets: MoveTarget[];
  availableMoveTargetIdsByFolderId: Record<string, string[]>;
};

export type FolderRestoreLocation = {
  kind: "original-parent" | "files-root";
  folderId: string;
  folderName: string;
  pathLabel: string;
};

export type FolderMutationResult = {
  folder: FolderSummary;
  restoredTo?: FolderRestoreLocation;
};

export type FileMutationResult = {
  file?: FileSummary;
  deletedFileId?: string;
  restoredTo?: FolderRestoreLocation;
};

export type TrashFolderSummary = {
  folder: FolderSummary;
  originalPathLabel: string;
  restoreLocation: FolderRestoreLocation;
};

export type TrashFileSummary = {
  file: FileSummary;
  originalPathLabel: string;
  restoreLocation: FolderRestoreLocation;
};

export type TrashListing = {
  filesRoot: FolderSummary;
  items: TrashFolderSummary[];
  files: TrashFileSummary[];
};

export type TrashClearResult = {
  deletedFolderCount: number;
  deletedFileCount: number;
};
