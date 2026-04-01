export type ShareLinkPolicy = {
  downloadDisabled: boolean;
};

export type SharedFolderTraversal = {
  rootFolderId: string;
  requestedFolderId: string;
  subtreeFolderIds: string[];
};

export const canBrowseSharedFolder = ({
  rootFolderId,
  requestedFolderId,
  subtreeFolderIds,
}: SharedFolderTraversal) =>
  requestedFolderId === rootFolderId ||
  subtreeFolderIds.includes(requestedFolderId);

export const getSharedDownloadAllowed = (policy: ShareLinkPolicy) =>
  !policy.downloadDisabled;

export const getSharedPreviewAllowed = (_policy: ShareLinkPolicy) => true;

export const getFolderArchiveDownloadAllowed = (policy: ShareLinkPolicy) =>
  !policy.downloadDisabled;

export const getSharedTreeExposureMode = () => "full-subtree" as const;

export const getSharingBoundary = () => ({
  recipientsCanReshare: false,
  hiddenChildFiltering: false,
});

export * from "./types";
export * from "./errors";
export * from "./schema";
export * from "./repository";
export * from "./access-cookie";
export * from "./archive";
export * from "./service";
