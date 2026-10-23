import type { FileSummary } from "@/server/files/types";

import type { PublicShareResolution, ShareLinkSummary } from "./types";

// Anyone holding a link sees these fields and nothing more: no owner ids,
// storage ids, or paths outside the shared item.

export const toPublicShare = ({
  downloadDisabled,
  expiresAt,
}: Pick<ShareLinkSummary, "downloadDisabled" | "expiresAt">) => ({
  downloadDisabled,
  expiresAt,
});

export const toPublicFile = ({
  id,
  name,
  mimeType,
  sizeBytes,
  viewerKind,
  updatedAt,
}: FileSummary) => ({ id, name, mimeType, sizeBytes, viewerKind, updatedAt });

/** A share page's data; a locked link says only that it is locked. */
export const toPublicShareView = (resolution: PublicShareResolution) => {
  if (resolution.access.requiresPassword && !resolution.access.isUnlocked) {
    return { kind: "locked" as const };
  }
  const share = toPublicShare(resolution.share);
  if (resolution.kind === "file") {
    return { kind: "file" as const, share, file: toPublicFile(resolution.file) };
  }
  const { listing } = resolution;
  return {
    kind: "folder" as const,
    share,
    listing: {
      rootFolderId: listing.rootFolder.id,
      currentFolder: {
        id: listing.currentFolder.id,
        name: listing.currentFolder.name,
      },
      breadcrumbs: listing.breadcrumbs,
      childFolders: listing.childFolders.map(({ id, name, updatedAt }) => ({
        id,
        name,
        updatedAt,
      })),
      files: listing.files.map(toPublicFile),
    },
  };
};

export type PublicShareView = ReturnType<typeof toPublicShareView>;
