import { createHash, randomBytes } from "node:crypto";

import type { ShareTargetType } from "@staaash/db/client";

import { env } from "@/lib/env";
import { canAccessPrivateNamespace } from "@/server/access";
import { authCrypto } from "@/server/auth/crypto";
import type { LibraryRepository } from "@/server/library/repository";
import type { LibraryActor } from "@/server/library/types";
import type {
  LibraryFileSummary,
  LibraryFolderSummary,
  StoredLibraryFile,
} from "@/server/library/types";

import { createSharedFolderArchive } from "./archive";
import { verifyShareAccessCookie } from "./access-cookie";
import { ShareError } from "./errors";
import type { SharingRepository } from "./repository";
import type {
  PublicShareResolution,
  ShareDownloadResult,
  ShareLibraryLookup,
  ShareLinkStatus,
  ShareLinkSummary,
  ShareTargetSummary,
  StoredShareLink,
} from "./types";

type CreateSharingServiceOptions = {
  repo?: SharingRepository;
  libraryRepo?: LibraryRepository;
  now?: () => Date;
  crypto?: typeof authCrypto;
};

const getShareLookupKey = (token: string) => {
  const separatorIndex = token.indexOf(".");

  return separatorIndex > 0 ? token.slice(0, separatorIndex) : null;
};

const signShareLookupKey = (tokenLookupKey: string) =>
  createHash("sha256")
    .update(env.AUTH_SECRET)
    .update(":share-token:")
    .update(tokenLookupKey)
    .digest("base64url");

export const buildShareToken = (tokenLookupKey: string) =>
  `${tokenLookupKey}.${signShareLookupKey(tokenLookupKey)}`;

export const buildShareUrl = (tokenLookupKey: string) =>
  new URL(`/s/${encodeURIComponent(buildShareToken(tokenLookupKey))}`, env.APP_URL)
    .toString();

const buildFolderMap = (folders: LibraryFolderSummary[]) =>
  new Map(folders.map((folder) => [folder.id, folder]));

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

const buildFilePathLabel = ({
  file,
  folderMap,
  libraryRoot,
}: {
  file: LibraryFileSummary;
  folderMap: Map<string, LibraryFolderSummary>;
  libraryRoot: LibraryFolderSummary;
}) => {
  const parent =
    file.folderId && folderMap.has(file.folderId)
      ? folderMap.get(file.folderId)
      : libraryRoot;
  const folderPath = parent
    ? buildFolderPathLabel({
        folder: parent,
        folderMap,
        libraryRoot,
      })
    : libraryRoot.name;

  return `${folderPath} / ${file.name}`;
};

const isFolderDeletedInTree = ({
  folder,
  folderMap,
}: {
  folder: LibraryFolderSummary;
  folderMap: Map<string, LibraryFolderSummary>;
}) => {
  let current: LibraryFolderSummary | undefined = folder;
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    if (current.deletedAt) {
      return true;
    }

    seen.add(current.id);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  return false;
};

const isFileDeletedInTree = ({
  file,
  folderMap,
}: {
  file: StoredLibraryFile;
  folderMap: Map<string, LibraryFolderSummary>;
}) => {
  if (file.deletedAt) {
    return true;
  }

  let ancestor = file.folderId ? folderMap.get(file.folderId) : undefined;
  const seen = new Set<string>();

  while (ancestor && !seen.has(ancestor.id)) {
    if (ancestor.deletedAt) {
      return true;
    }

    seen.add(ancestor.id);
    ancestor = ancestor.parentId ? folderMap.get(ancestor.parentId) : undefined;
  }

  return false;
};

const isFolderWithinRoot = ({
  folderId,
  rootFolderId,
  folderMap,
}: {
  folderId: string;
  rootFolderId: string;
  folderMap: Map<string, LibraryFolderSummary>;
}) => {
  let current = folderMap.get(folderId);
  const seen = new Set<string>();

  while (current && !seen.has(current.id)) {
    if (current.id === rootFolderId) {
      return true;
    }

    seen.add(current.id);
    current = current.parentId ? folderMap.get(current.parentId) : undefined;
  }

  return false;
};

const toLibraryFileSummary = (file: StoredLibraryFile): LibraryFileSummary => ({
  id: file.id,
  ownerUserId: file.ownerUserId,
  ownerUsername: file.ownerUsername,
  folderId: file.folderId,
  name: file.name,
  mimeType: file.mimeType,
  sizeBytes: file.sizeBytes,
  deletedAt: file.deletedAt,
  createdAt: file.createdAt,
  updatedAt: file.updatedAt,
});

const getShareStatus = ({
  share,
  targetUnavailable,
  now,
}: {
  share: StoredShareLink;
  targetUnavailable: boolean;
  now: Date;
}): ShareLinkStatus => {
  if (share.revokedAt) {
    return "revoked";
  }

  if (share.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }

  if (targetUnavailable) {
    return "target-unavailable";
  }

  return "active";
};

export const createSharingService = ({
  repo,
  libraryRepo,
  now = () => new Date(),
  crypto = authCrypto,
}: CreateSharingServiceOptions = {}) => {
  const resolveRepo = async (): Promise<SharingRepository> =>
    repo ?? (await import("./repository")).prismaSharingRepository;
  const resolveLibraryRepo = async () =>
    libraryRepo ??
    (await import("@/server/library/repository")).prismaLibraryRepository;

  const resolveLibraryState = async (ownerUserId: string) => {
    const libraryRepo = await resolveLibraryRepo();
    const [libraryRoot, folders, files] = await Promise.all([
      libraryRepo.ensureLibraryRoot(ownerUserId),
      libraryRepo.listFoldersByOwner(ownerUserId, {
        includeDeleted: true,
      }),
      libraryRepo.listFilesByOwner(ownerUserId, {
        includeDeleted: true,
      }),
    ]);

    return {
      libraryRoot,
      folders,
      files,
      folderMap: buildFolderMap(folders),
      fileMap: new Map(files.map((file) => [file.id, file])),
    };
  };

  const assertCanManageTarget = (
    actor: LibraryActor,
    target: { ownerUserId: string } | null,
  ) => {
    if (!target) {
      throw new ShareError("SHARE_TARGET_UNAVAILABLE");
    }

    if (
      !canAccessPrivateNamespace({
        actorRole: actor.actorRole,
        actorUserId: actor.actorUserId,
        namespaceOwnerUserId: target.ownerUserId,
      }) ||
      actor.actorUserId !== target.ownerUserId
    ) {
      throw new ShareError("SHARE_ACCESS_DENIED");
    }
  };

  const assertActiveTarget = ({
    targetType,
    file,
    folder,
    folderMap,
  }: {
    targetType: ShareTargetType;
    file?: StoredLibraryFile | null;
    folder?: LibraryFolderSummary | null;
    folderMap?: Map<string, LibraryFolderSummary>;
  }) => {
    if (
      targetType === "file" &&
      (!file || !folderMap || isFileDeletedInTree({ file, folderMap }))
    ) {
      throw new ShareError("SHARE_TARGET_UNAVAILABLE");
    }

    if (
      targetType === "folder" &&
      (!folder || !folderMap || isFolderDeletedInTree({ folder, folderMap }))
    ) {
      throw new ShareError("SHARE_TARGET_UNAVAILABLE");
    }
  };

  const issueTokenPair = () => {
    const tokenLookupKey = randomBytes(24).toString("base64url");
    const token = buildShareToken(tokenLookupKey);

    return {
      tokenLookupKey,
      token,
      tokenHash: crypto.hashOpaqueToken(token),
      shareUrl: buildShareUrl(tokenLookupKey),
    };
  };

  const buildTargetSummary = ({
    share,
    fileMap,
    folderMap,
    libraryRoot,
  }: {
    share: StoredShareLink;
    fileMap: Map<string, StoredLibraryFile>;
    folderMap: Map<string, LibraryFolderSummary>;
    libraryRoot: LibraryFolderSummary;
  }): { summary: ShareTargetSummary; targetUnavailable: boolean } => {
    if (share.targetType === "file") {
      const file = share.fileId ? fileMap.get(share.fileId) : null;

      return {
        summary: {
          targetType: "file",
          id: file?.id ?? share.fileId ?? share.id,
          ownerUserId: file?.ownerUserId ?? share.createdByUserId,
          ownerUsername: file?.ownerUsername ?? "unknown",
          name: file?.name ?? "Unavailable file",
          folderId: file?.folderId ?? null,
          mimeType: file?.mimeType ?? "application/octet-stream",
          sizeBytes: file?.sizeBytes ?? 0,
          pathLabel: file
            ? buildFilePathLabel({
                file: toLibraryFileSummary(file),
                folderMap,
                libraryRoot,
              })
            : "Unavailable file",
          deletedAt: file?.deletedAt ?? now(),
        },
        targetUnavailable: !file || isFileDeletedInTree({ file, folderMap }),
      };
    }

    const folder = share.folderId ? folderMap.get(share.folderId) : null;

    return {
      summary: {
        targetType: "folder",
        id: folder?.id ?? share.folderId ?? share.id,
        ownerUserId: folder?.ownerUserId ?? share.createdByUserId,
        ownerUsername: folder?.ownerUsername ?? "unknown",
        name: folder?.name ?? "Unavailable folder",
        parentId: folder?.parentId ?? null,
        isLibraryRoot: folder?.isLibraryRoot ?? false,
        pathLabel: folder
          ? buildFolderPathLabel({
              folder,
              folderMap,
              libraryRoot,
            })
          : "Unavailable folder",
        deletedAt: folder?.deletedAt ?? now(),
      },
      targetUnavailable: !folder || isFolderDeletedInTree({ folder, folderMap }),
    };
  };

  const toShareSummary = ({
    share,
    target,
    targetUnavailable,
  }: {
    share: StoredShareLink;
    target: ShareTargetSummary;
    targetUnavailable: boolean;
  }): ShareLinkSummary => ({
    id: share.id,
    createdByUserId: share.createdByUserId,
    targetType: share.targetType,
    fileId: share.fileId,
    folderId: share.folderId,
    shareUrl: buildShareUrl(share.tokenLookupKey),
    hasPassword: Boolean(share.passwordHash),
    downloadDisabled: share.downloadDisabled,
    expiresAt: share.expiresAt,
    revokedAt: share.revokedAt,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    status: getShareStatus({
      share,
      targetUnavailable,
      now: now(),
    }),
    target,
  });

  const getManagedShare = async ({
    actor,
    shareId,
  }: {
    actor: LibraryActor;
    shareId: string;
  }) => {
    const share = await (await resolveRepo()).findShareById(shareId);

    if (!share) {
      throw new ShareError("SHARE_NOT_FOUND");
    }

    if (share.createdByUserId !== actor.actorUserId) {
      throw new ShareError("SHARE_ACCESS_DENIED");
    }

    return share;
  };

  const getValidatedPublicShare = async (token: string) => {
    const tokenLookupKey = getShareLookupKey(token);

    if (!tokenLookupKey) {
      throw new ShareError("SHARE_INVALID");
    }

    const share = await (await resolveRepo()).findShareByTokenLookupKey(
      tokenLookupKey,
    );

    if (!share) {
      throw new ShareError("SHARE_NOT_FOUND");
    }

    if (crypto.hashOpaqueToken(token) !== share.tokenHash) {
      throw new ShareError("SHARE_INVALID");
    }

    if (share.revokedAt) {
      throw new ShareError("SHARE_INVALID");
    }

    if (share.expiresAt.getTime() <= now().getTime()) {
      throw new ShareError("SHARE_EXPIRED");
    }

    return share;
  };

  const getAccessState = ({
    share,
    shareAccessCookieValue,
  }: {
    share: StoredShareLink;
    shareAccessCookieValue: string | null | undefined;
  }) => ({
    requiresPassword: Boolean(share.passwordHash),
    isUnlocked:
      !share.passwordHash ||
      verifyShareAccessCookie({
        cookieValue: shareAccessCookieValue,
        shareId: share.id,
        tokenLookupKey: share.tokenLookupKey,
        passwordHash: share.passwordHash,
      }),
  });

  return {
    async createOrReissueShare({
      actorUserId,
      actorRole,
      targetType,
      fileId,
      folderId,
      expiresAt,
      downloadDisabled = false,
      password,
    }: LibraryActor & {
      targetType: ShareTargetType;
      fileId?: string | null;
      folderId?: string | null;
      expiresAt?: Date;
      downloadDisabled?: boolean;
      password?: string | null;
    }) {
      const libraryRepo = await resolveLibraryRepo();
      const actor = { actorUserId, actorRole };
      const effectiveExpiresAt =
        expiresAt ??
        new Date(
          now().getTime() + env.SHARE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
        );

      if (effectiveExpiresAt.getTime() <= now().getTime()) {
        throw new ShareError("SHARE_INVALID", "Share expiry must be in the future.");
      }

      const { folderMap } = await resolveLibraryState(actorUserId);
      const file =
        targetType === "file" && fileId
          ? await libraryRepo.findFileById(fileId)
          : null;
      const folder =
        targetType === "folder" && folderId
          ? await libraryRepo.findFolderById(folderId)
          : null;

      assertCanManageTarget(actor, file ?? folder);
      assertActiveTarget({
        targetType,
        file,
        folder,
        folderMap,
      });

      const existing =
        targetType === "file"
          ? await (await resolveRepo()).findShareByFileId(fileId!)
          : await (await resolveRepo()).findShareByFolderId(folderId!);
      const issued = issueTokenPair();
      const passwordHash = password
        ? await crypto.hashPassword(password)
        : null;

      const share = existing
        ? await (await resolveRepo()).updateShare({
            id: existing.id,
            tokenLookupKey: issued.tokenLookupKey,
            tokenHash: issued.tokenHash,
            passwordHash,
            downloadDisabled,
            expiresAt: effectiveExpiresAt,
            revokedAt: null,
          })
        : await (await resolveRepo()).createShare({
            createdByUserId: actorUserId,
            targetType,
            fileId: fileId ?? null,
            folderId: folderId ?? null,
            tokenLookupKey: issued.tokenLookupKey,
            tokenHash: issued.tokenHash,
            passwordHash,
            downloadDisabled,
            expiresAt: effectiveExpiresAt,
          });

      return {
        share,
        shareUrl: issued.shareUrl,
        token: issued.token,
      };
    },

    async listOwnedShares({ actorUserId }: LibraryActor) {
      const [shares, { libraryRoot, folderMap, fileMap }] = await Promise.all([
        (await resolveRepo()).listSharesByCreator(actorUserId),
        resolveLibraryState(actorUserId),
      ]);

      const summaries = shares.map((share) => {
        const target = buildTargetSummary({
          share,
          fileMap,
          folderMap,
          libraryRoot,
        });

        return toShareSummary({
          share,
          target: target.summary,
          targetUnavailable: target.targetUnavailable,
        });
      });

      return {
        active: summaries.filter((share) => share.status === "active"),
        inactive: summaries.filter((share) => share.status !== "active"),
      };
    },

    async getLibraryShareLookup({
      actorUserId,
      actorRole,
      currentFolderId,
      childFolderIds,
      fileIds,
    }: LibraryActor & {
      currentFolderId: string;
      childFolderIds: string[];
      fileIds: string[];
    }): Promise<ShareLibraryLookup> {
      const grouped = await this.listOwnedShares({
        actorUserId,
        actorRole,
      });
      const allShares = [...grouped.active, ...grouped.inactive];
      const folderIdSet = new Set([currentFolderId, ...childFolderIds]);
      const fileIdSet = new Set(fileIds);
      const sharesByFolderId: Record<string, ShareLinkSummary> = {};
      const sharesByFileId: Record<string, ShareLinkSummary> = {};
      let currentFolderShare: ShareLinkSummary | null = null;

      for (const share of allShares) {
        if (share.folderId && folderIdSet.has(share.folderId)) {
          sharesByFolderId[share.folderId] = share;

          if (share.folderId === currentFolderId) {
            currentFolderShare = share;
          }
        }

        if (share.fileId && fileIdSet.has(share.fileId)) {
          sharesByFileId[share.fileId] = share;
        }
      }

      return {
        currentFolderShare,
        sharesByFolderId,
        sharesByFileId,
      };
    },

    async updateShare({
      actorUserId,
      actorRole,
      shareId,
      expiresAt,
      downloadDisabled,
    }: LibraryActor & {
      shareId: string;
      expiresAt: Date;
      downloadDisabled: boolean;
    }) {
      if (expiresAt.getTime() <= now().getTime()) {
        throw new ShareError("SHARE_INVALID", "Share expiry must be in the future.");
      }

      const share = await getManagedShare({
        actor: {
          actorUserId,
          actorRole,
        },
        shareId,
      });

      return (await resolveRepo()).updateShare({
        id: share.id,
        expiresAt,
        downloadDisabled,
      });
    },

    async updateSharePassword({
      actorUserId,
      actorRole,
      shareId,
      password,
    }: LibraryActor & {
      shareId: string;
      password: string | null;
    }) {
      const share = await getManagedShare({
        actor: {
          actorUserId,
          actorRole,
        },
        shareId,
      });

      return (await resolveRepo()).updateShare({
        id: share.id,
        passwordHash: password ? await crypto.hashPassword(password) : null,
      });
    },

    async revokeShare({
      actorUserId,
      actorRole,
      shareId,
    }: LibraryActor & {
      shareId: string;
    }) {
      const share = await getManagedShare({
        actor: {
          actorUserId,
          actorRole,
        },
        shareId,
      });

      return (await resolveRepo()).updateShare({
        id: share.id,
        revokedAt: now(),
      });
    },

    async deleteShare({
      actorUserId,
      actorRole,
      shareId,
    }: LibraryActor & {
      shareId: string;
    }) {
      await getManagedShare({
        actor: {
          actorUserId,
          actorRole,
        },
        shareId,
      });
      await (await resolveRepo()).deleteShare(shareId);
    },

    async unlockShare({
      token,
      password,
    }: {
      token: string;
      password: string;
    }) {
      const share = await getValidatedPublicShare(token);

      if (!share.passwordHash) {
        throw new ShareError("SHARE_INVALID");
      }

      const isValid = await crypto.verifyPassword(password, share.passwordHash);

      if (!isValid) {
        throw new ShareError("SHARE_PASSWORD_INVALID");
      }

      return {
        share,
      };
    },

    async resolvePublicShare({
      token,
      requestedFolderId,
      shareAccessCookieValue,
    }: {
      token: string;
      requestedFolderId?: string;
      shareAccessCookieValue?: string | null;
    }): Promise<PublicShareResolution> {
      const share = await getValidatedPublicShare(token);
      const libraryRepo = await resolveLibraryRepo();
      const rootState = await resolveLibraryState(share.createdByUserId);
      const access = getAccessState({
        share,
        shareAccessCookieValue,
      });
      const target = buildTargetSummary({
        share,
        fileMap: rootState.fileMap,
        folderMap: rootState.folderMap,
        libraryRoot: rootState.libraryRoot,
      });
      const shareSummary = toShareSummary({
        share,
        target: target.summary,
        targetUnavailable: target.targetUnavailable,
      });

      if (target.targetUnavailable) {
        throw new ShareError("SHARE_TARGET_UNAVAILABLE");
      }

      if (share.targetType === "file") {
        const file = await libraryRepo.findFileById(share.fileId!);

        assertActiveTarget({
          targetType: "file",
          file,
          folderMap: rootState.folderMap,
        });

        return {
          kind: "file",
          share: shareSummary,
          access,
          file: toLibraryFileSummary(file!),
        };
      }

      const rootFolder = await libraryRepo.findFolderById(share.folderId!);

      assertActiveTarget({
        targetType: "folder",
        folder: rootFolder,
        folderMap: rootState.folderMap,
      });

      const currentFolder = requestedFolderId
        ? await libraryRepo.findFolderById(requestedFolderId)
        : rootFolder;

      if (
        !currentFolder ||
        currentFolder.deletedAt ||
        !isFolderWithinRoot({
          folderId: currentFolder.id,
          rootFolderId: rootFolder!.id,
          folderMap: rootState.folderMap,
        })
      ) {
        throw new ShareError("SHARE_ACCESS_DENIED");
      }

      const breadcrumbs: Array<{ id: string; name: string; href: string }> = [];
      const trail: LibraryFolderSummary[] = [];
      let pointer: LibraryFolderSummary | undefined = currentFolder;
      const seen = new Set<string>();

      while (pointer && !seen.has(pointer.id)) {
        trail.unshift(pointer);
        seen.add(pointer.id);

        if (pointer.id === rootFolder!.id) {
          break;
        }

        pointer = pointer.parentId
          ? rootState.folderMap.get(pointer.parentId)
          : undefined;
      }

      for (const folder of trail) {
        breadcrumbs.push({
          id: folder.id,
          name: folder.name,
          href:
            folder.id === rootFolder!.id
              ? `/s/${encodeURIComponent(token)}`
              : `/s/${encodeURIComponent(token)}/f/${folder.id}`,
        });
      }

      return {
        kind: "folder",
        share: shareSummary,
        access,
        listing: {
          rootFolder: rootFolder!,
          currentFolder,
          breadcrumbs,
          childFolders: access.isUnlocked
            ? rootState.folders.filter(
                (folder) =>
                  folder.parentId === currentFolder.id && !folder.deletedAt,
              )
            : [],
          files: access.isUnlocked
            ? rootState.files
                .filter((file) => file.folderId === currentFolder.id)
                .filter(
                  (file) =>
                    !isFileDeletedInTree({
                      file,
                      folderMap: rootState.folderMap,
                    }),
                )
                .map(toLibraryFileSummary)
            : [],
        },
      };
    },

    async getSharedFileDownload({
      token,
      shareAccessCookieValue,
    }: {
      token: string;
      shareAccessCookieValue?: string | null;
    }): Promise<ShareDownloadResult> {
      const resolved = await this.resolvePublicShare({
        token,
        shareAccessCookieValue,
      });

      if (resolved.kind !== "file") {
        throw new ShareError("SHARE_ACCESS_DENIED");
      }

      if (!resolved.access.isUnlocked) {
        throw new ShareError("SHARE_PASSWORD_REQUIRED");
      }

      if (resolved.share.downloadDisabled) {
        throw new ShareError("SHARE_DOWNLOAD_DISABLED");
      }

      const file = (await (await resolveLibraryRepo()).findFileById(
        resolved.file.id,
      ))!;

      return {
        file,
        contentType: file.mimeType || "application/octet-stream",
        contentLength: file.sizeBytes,
      };
    },

    async getSharedNestedFileDownload({
      token,
      fileId,
      shareAccessCookieValue,
    }: {
      token: string;
      fileId: string;
      shareAccessCookieValue?: string | null;
    }): Promise<ShareDownloadResult> {
      const resolved = await this.resolvePublicShare({
        token,
        shareAccessCookieValue,
      });

      if (resolved.kind !== "folder") {
        throw new ShareError("SHARE_ACCESS_DENIED");
      }

      if (!resolved.access.isUnlocked) {
        throw new ShareError("SHARE_PASSWORD_REQUIRED");
      }

      if (resolved.share.downloadDisabled) {
        throw new ShareError("SHARE_DOWNLOAD_DISABLED");
      }

      const libraryRepo = await resolveLibraryRepo();
      const file = await libraryRepo.findFileById(fileId);
      const libraryState = await resolveLibraryState(
        resolved.listing.rootFolder.ownerUserId,
      );

      if (
        !file ||
        isFileDeletedInTree({
          file,
          folderMap: libraryState.folderMap,
        }) ||
        !file.folderId ||
        !isFolderWithinRoot({
          folderId: file.folderId,
          rootFolderId: resolved.listing.rootFolder.id,
          folderMap: libraryState.folderMap,
        })
      ) {
        throw new ShareError("SHARE_ACCESS_DENIED");
      }

      return {
        file,
        contentType: file.mimeType || "application/octet-stream",
        contentLength: file.sizeBytes,
      };
    },

    async createFolderArchive({
      token,
      shareAccessCookieValue,
    }: {
      token: string;
      shareAccessCookieValue?: string | null;
    }) {
      const resolved = await this.resolvePublicShare({
        token,
        shareAccessCookieValue,
      });

      if (resolved.kind !== "folder") {
        throw new ShareError("SHARE_ACCESS_DENIED");
      }

      if (!resolved.access.isUnlocked) {
        throw new ShareError("SHARE_PASSWORD_REQUIRED");
      }

      if (resolved.share.downloadDisabled) {
        throw new ShareError("SHARE_DOWNLOAD_DISABLED");
      }

      const libraryState = await resolveLibraryState(
        resolved.listing.rootFolder.ownerUserId,
      );
      const folders = libraryState.folders.filter(
        (folder) =>
          !folder.deletedAt &&
          isFolderWithinRoot({
            folderId: folder.id,
            rootFolderId: resolved.listing.rootFolder.id,
            folderMap: libraryState.folderMap,
          }),
      );
      const files = libraryState.files.filter(
        (file) =>
          !isFileDeletedInTree({
            file,
            folderMap: libraryState.folderMap,
          }) &&
          file.folderId &&
          isFolderWithinRoot({
            folderId: file.folderId,
            rootFolderId: resolved.listing.rootFolder.id,
            folderMap: libraryState.folderMap,
          }),
      );

      return createSharedFolderArchive({
        rootFolder: resolved.listing.rootFolder,
        folders,
        files,
      });
    },
  };
};

export const sharingService = createSharingService();
