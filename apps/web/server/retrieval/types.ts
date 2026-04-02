import type {
  LibraryFileSummary,
  LibraryFolderSummary,
} from "@/server/library/types";
import type { SearchMatchKind } from "@/server/types";

export type RetrievalItem =
  | {
      kind: "folder";
      id: string;
      name: string;
      pathLabel: string;
      href: string;
      updatedAt: Date;
      isFavorite: boolean;
      matchKind?: SearchMatchKind;
      parentId: string | null;
    }
  | {
      kind: "file";
      id: string;
      name: string;
      pathLabel: string;
      href: string;
      updatedAt: Date;
      isFavorite: boolean;
      matchKind?: SearchMatchKind;
      folderId: string | null;
      mimeType: string;
      sizeBytes: number;
    };

export type FavoriteMutationResult = {
  kind: RetrievalItem["kind"];
  id: string;
  isFavorite: boolean;
};

export type FavoriteFileRecord = {
  userId: string;
  fileId: string;
  createdAt: Date;
};

export type FavoriteFolderRecord = {
  userId: string;
  folderId: string;
  createdAt: Date;
};

export type RecentFileRecord = {
  userId: string;
  fileId: string;
  lastInteractedAt: Date;
};

export type RecentFolderRecord = {
  userId: string;
  folderId: string;
  lastInteractedAt: Date;
};

export type RetrievalRepository = {
  ensureLibraryRoot(ownerUserId: string): Promise<LibraryFolderSummary>;
  findFolderById(folderId: string): Promise<LibraryFolderSummary | null>;
  findFileById(fileId: string): Promise<LibraryFileSummary | null>;
  listFoldersByOwner(ownerUserId: string): Promise<LibraryFolderSummary[]>;
  listFilesByOwner(ownerUserId: string): Promise<LibraryFileSummary[]>;
  listFavoriteFiles(userId: string): Promise<FavoriteFileRecord[]>;
  listFavoriteFolders(userId: string): Promise<FavoriteFolderRecord[]>;
  listRecentFiles(userId: string): Promise<RecentFileRecord[]>;
  listRecentFolders(userId: string): Promise<RecentFolderRecord[]>;
  upsertFileFavorite(params: {
    userId: string;
    fileId: string;
    createdAt: Date;
  }): Promise<void>;
  deleteFileFavorite(params: { userId: string; fileId: string }): Promise<void>;
  upsertFolderFavorite(params: {
    userId: string;
    folderId: string;
    createdAt: Date;
  }): Promise<void>;
  deleteFolderFavorite(params: {
    userId: string;
    folderId: string;
  }): Promise<void>;
  upsertRecentFile(params: {
    userId: string;
    fileId: string;
    lastInteractedAt: Date;
  }): Promise<void>;
  upsertRecentFolder(params: {
    userId: string;
    folderId: string;
    lastInteractedAt: Date;
  }): Promise<void>;
};
