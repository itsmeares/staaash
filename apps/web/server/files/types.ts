import type { UserRole } from "@/server/types";
import type { ViewerKind } from "@staaash/db/viewer-contract";
import type { StorageMutationState } from "@/server/storage-read-guard";

export type FilesActor = {
  actorUserId: string;
  actorRole: UserRole;
};

export type FolderSummary = {
  id: string;
  ownerUserId: string;
  ownerStorageId: string;
  parentId: string | null;
  name: string;
  isFilesRoot: boolean;
  /** A named swatch or a custom "#rrggbb"; null is the default. */
  color?: string | null;
  /** A folder icon name; null is the plain folder. */
  icon?: string | null;
  deletedAt: Date | null;
  storageRevision?: number;
  trashEntryId?: string | null;
  storageMutation?: StorageMutationState | null;
  createdAt: Date;
  updatedAt: Date;
};

export type FileSummary = {
  id: string;
  ownerUserId: string;
  ownerStorageId: string;
  folderId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  viewerKind: ViewerKind | null;
  storageRevision?: number;
  trashEntryId?: string | null;
  storageMutation?: StorageMutationState | null;
  /** The modified time on the uploader's computer, when it sent one. */
  clientModifiedAt?: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StoredFile = FileSummary & {
  storageKey: string;
  storageStatus: "available" | "missing";
  storageCheckedAt: Date | null;
  storageMissingAt: Date | null;
  contentChecksum: string | null;
  storageMutation?: StorageMutationState | null;
};

export type FilesBreadcrumb = {
  id: string;
  name: string;
  href: string;
};

/** A folder in the move picker's tree. */
export type MoveTarget = {
  id: string;
  parentId: string | null;
  name: string;
  pathLabel: string;
  isFilesRoot: boolean;
  color: string | null;
};

export type BatchMoveItem = {
  id: string;
  kind: "file" | "folder";
};

export type BatchMoveResult =
  | (BatchMoveItem & {
      status: "moved";
    })
  | (BatchMoveItem & {
      status: "failed";
      code: string;
      error: string;
      retryable?: boolean;
    });

export type BatchMoveResponse = {
  movedCount: number;
  failedCount: number;
  results: BatchMoveResult[];
};

export type BatchMoveOperationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "recovery_required";

export type BatchMoveOperationResponse = {
  operationId: string;
  status: BatchMoveOperationStatus;
  response?: BatchMoveResponse;
  error?: string;
  items?: BatchMoveItem[];
  destinationFolderId?: string;
  source?: "direct" | "paste";
};

export type FilesListing = {
  total: number;
  counts: { folders: number; files: number };
  ownerUserId: string;
  currentFolder: FolderSummary;
  breadcrumbs: FilesBreadcrumb[];
  childFolders: FolderSummary[];
  files: FileSummary[];
  /** Up to two file ids per child folder whose thumbnails can peek out. */
  folderPreviews: Record<string, string[]>;
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
  total: number;
  order?: string[];
  filesRoot: FolderSummary;
  items: TrashFolderSummary[];
  files: TrashFileSummary[];
};

export type TrashClearResult = {
  deletedFolderCount: number;
  deletedFileCount: number;
};
