import type { ShareTargetType } from "@staaash/db/client";

import type { FileSummary, FolderSummary } from "@/server/files/types";

export type ShareLinkStatus =
  | "active"
  | "expired"
  | "revoked"
  | "target-unavailable";

export type StoredShareLink = {
  id: string;
  createdByUserId: string;
  targetType: ShareTargetType;
  fileId: string | null;
  folderId: string | null;
  tokenLookupKey: string;
  tokenHash: string;
  passwordHash: string | null;
  downloadDisabled: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ShareTargetSummary =
  | {
      targetType: "file";
      id: string;
      ownerUserId: string;
      ownerUsername: string;
      name: string;
      folderId: string | null;
      mimeType: string;
      sizeBytes: number;
      pathLabel: string;
      deletedAt: Date | null;
    }
  | {
      targetType: "folder";
      id: string;
      ownerUserId: string;
      ownerUsername: string;
      name: string;
      parentId: string | null;
      isFilesRoot: boolean;
      pathLabel: string;
      deletedAt: Date | null;
    };

export type ShareLinkSummary = {
  id: string;
  createdByUserId: string;
  targetType: ShareTargetType;
  fileId: string | null;
  folderId: string | null;
  shareUrl: string;
  hasPassword: boolean;
  downloadDisabled: boolean;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  status: ShareLinkStatus;
  target: ShareTargetSummary;
};

export type SharePolicyInput = {
  expiresAt?: Date;
  downloadDisabled?: boolean;
  password?: string | null;
};

export type ShareAccessState = {
  requiresPassword: boolean;
  isUnlocked: boolean;
};

export type SharedFolderListing = {
  rootFolder: FolderSummary;
  currentFolder: FolderSummary;
  breadcrumbs: Array<{
    id: string;
    name: string;
    href: string;
  }>;
  childFolders: FolderSummary[];
  files: FileSummary[];
};

export type PublicShareResolution =
  | {
      kind: "file";
      share: ShareLinkSummary;
      access: ShareAccessState;
      file: FileSummary;
    }
  | {
      kind: "folder";
      share: ShareLinkSummary;
      access: ShareAccessState;
      listing: SharedFolderListing;
    };

export type ShareFilesLookup = {
  currentFolderShare: ShareLinkSummary | null;
  sharesByFolderId: Record<string, ShareLinkSummary>;
  sharesByFileId: Record<string, ShareLinkSummary>;
};

export type ShareDownloadResult = {
  file: FileSummary & {
    storageKey: string;
  };
  contentType: string;
  contentLength: number;
};
