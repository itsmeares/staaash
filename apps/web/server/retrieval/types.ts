import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { SearchMatchKind } from "@/server/types";
import type { StorageMutationState } from "@/server/storage-read-guard";

export type RetrievalItem =
  | {
      kind: "folder";
      id: string;
      name: string;
      pathLabel: string;
      href: string;
      updatedAt: Date;
      deletedAt: Date | null;
      isFavorite: boolean;
      matchKind?: SearchMatchKind;
      parentId: string | null;
      color?: string | null;
      storageMutation?: StorageMutationState | null;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      pathLabel: string;
      href: string;
      updatedAt: Date;
      deletedAt: Date | null;
      isFavorite: boolean;
      matchKind?: SearchMatchKind;
      folderId: string | null;
      mimeType: string;
      sizeBytes: number;
      storageMutation?: StorageMutationState | null;
    };

export type FavoriteRetrievalItem = RetrievalItem & {
  favoritedAt: Date;
  quickAccessPinnedAt: Date | null;
};

export type FavoriteMutationResult = {
  kind: RetrievalItem["kind"];
  id: string;
  isFavorite: boolean;
  quickAccessPinnedAt?: Date | null;
};

/** What someone last did with an item; matches the RecentAction enum. */
export type RecentAction =
  | "opened"
  | "uploaded"
  | "created"
  | "renamed"
  | "moved"
  | "downloaded"
  | "trashed"
  | "restored";

export type RecentRetrievalItem = RetrievalItem & {
  lastInteractedAt: Date;
  /** Empty for activity recorded before actions were kept. */
  lastAction: RecentAction | null;
};

export type RetrievalRepository = {
  findFolderById(folderId: string): Promise<FolderSummary | null>;
  findFileById(fileId: string): Promise<FileSummary | null>;
  upsertFileFavorite(params: {
    userId: string;
    fileId: string;
    createdAt: Date;
  }): Promise<void>;
  deleteFileFavorite(params: { userId: string; fileId: string }): Promise<void>;
  updateFileFavoriteQuickAccess(params: {
    userId: string;
    fileId: string;
    quickAccessPinnedAt: Date | null;
  }): Promise<boolean>;
  upsertFolderFavorite(params: {
    userId: string;
    folderId: string;
    createdAt: Date;
  }): Promise<void>;
  deleteFolderFavorite(params: {
    userId: string;
    folderId: string;
  }): Promise<void>;
  updateFolderFavoriteQuickAccess(params: {
    userId: string;
    folderId: string;
    quickAccessPinnedAt: Date | null;
  }): Promise<boolean>;
  upsertRecentFile(params: {
    userId: string;
    fileId: string;
    lastInteractedAt: Date;
    lastAction: RecentAction;
  }): Promise<void>;
  upsertRecentFolder(params: {
    userId: string;
    folderId: string;
    lastInteractedAt: Date;
    lastAction: RecentAction;
  }): Promise<void>;
};
