import { Prisma, prisma } from "@staaash/db/client";

import type { StoredShareLink } from "./types";

const shareLinkSelect = {
  id: true,
  createdByUserId: true,
  targetType: true,
  fileId: true,
  folderId: true,
  tokenLookupKey: true,
  tokenHash: true,
  passwordHash: true,
  downloadDisabled: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ShareLinkSelect;

type ShareLinkRecord = Prisma.ShareLinkGetPayload<{
  select: typeof shareLinkSelect;
}>;

type CreateShareParams = {
  createdByUserId: string;
  targetType: "file" | "folder";
  fileId?: string | null;
  folderId?: string | null;
  tokenLookupKey: string;
  tokenHash: string;
  passwordHash: string | null;
  downloadDisabled: boolean;
  expiresAt: Date;
  revokedAt?: Date | null;
};

type UpdateShareParams = {
  id: string;
  tokenLookupKey?: string;
  tokenHash?: string;
  passwordHash?: string | null;
  downloadDisabled?: boolean;
  expiresAt?: Date;
  revokedAt?: Date | null;
};

const toStoredShareLink = (shareLink: ShareLinkRecord): StoredShareLink => ({
  id: shareLink.id,
  createdByUserId: shareLink.createdByUserId,
  targetType: shareLink.targetType,
  fileId: shareLink.fileId,
  folderId: shareLink.folderId,
  tokenLookupKey: shareLink.tokenLookupKey,
  tokenHash: shareLink.tokenHash,
  passwordHash: shareLink.passwordHash,
  downloadDisabled: shareLink.downloadDisabled,
  expiresAt: shareLink.expiresAt,
  revokedAt: shareLink.revokedAt,
  createdAt: shareLink.createdAt,
  updatedAt: shareLink.updatedAt,
});

export type SharingRepository = {
  findShareById(shareId: string): Promise<StoredShareLink | null>;
  findShareByFileId(fileId: string): Promise<StoredShareLink | null>;
  findShareByFolderId(folderId: string): Promise<StoredShareLink | null>;
  findShareByTokenLookupKey(tokenLookupKey: string): Promise<StoredShareLink | null>;
  listSharesByCreator(createdByUserId: string): Promise<StoredShareLink[]>;
  createShare(params: CreateShareParams): Promise<StoredShareLink>;
  updateShare(params: UpdateShareParams): Promise<StoredShareLink>;
  deleteShare(shareId: string): Promise<void>;
};

export const createPrismaSharingRepository = (
  client = prisma,
): SharingRepository => ({
  async findShareById(shareId) {
    const shareLink = await client.shareLink.findUnique({
      where: {
        id: shareId,
      },
      select: shareLinkSelect,
    });

    return shareLink ? toStoredShareLink(shareLink) : null;
  },

  async findShareByFileId(fileId) {
    const shareLink = await client.shareLink.findUnique({
      where: {
        fileId,
      },
      select: shareLinkSelect,
    });

    return shareLink ? toStoredShareLink(shareLink) : null;
  },

  async findShareByFolderId(folderId) {
    const shareLink = await client.shareLink.findUnique({
      where: {
        folderId,
      },
      select: shareLinkSelect,
    });

    return shareLink ? toStoredShareLink(shareLink) : null;
  },

  async findShareByTokenLookupKey(tokenLookupKey) {
    const shareLink = await client.shareLink.findUnique({
      where: {
        tokenLookupKey,
      },
      select: shareLinkSelect,
    });

    return shareLink ? toStoredShareLink(shareLink) : null;
  },

  async listSharesByCreator(createdByUserId) {
    const shareLinks = await client.shareLink.findMany({
      where: {
        createdByUserId,
      },
      orderBy: [
        {
          revokedAt: "asc",
        },
        {
          updatedAt: "desc",
        },
      ],
      select: shareLinkSelect,
    });

    return shareLinks.map(toStoredShareLink);
  },

  async createShare(params) {
    const shareLink = await client.shareLink.create({
      data: {
        createdByUserId: params.createdByUserId,
        targetType: params.targetType,
        fileId: params.fileId ?? null,
        folderId: params.folderId ?? null,
        tokenLookupKey: params.tokenLookupKey,
        tokenHash: params.tokenHash,
        passwordHash: params.passwordHash,
        downloadDisabled: params.downloadDisabled,
        expiresAt: params.expiresAt,
        revokedAt: params.revokedAt ?? null,
      },
      select: shareLinkSelect,
    });

    return toStoredShareLink(shareLink);
  },

  async updateShare(params) {
    const data: Prisma.ShareLinkUpdateInput = {};

    if ("tokenLookupKey" in params && params.tokenLookupKey !== undefined) {
      data.tokenLookupKey = params.tokenLookupKey;
    }

    if ("tokenHash" in params && params.tokenHash !== undefined) {
      data.tokenHash = params.tokenHash;
    }

    if ("passwordHash" in params) {
      data.passwordHash = params.passwordHash;
    }

    if ("downloadDisabled" in params && params.downloadDisabled !== undefined) {
      data.downloadDisabled = params.downloadDisabled;
    }

    if ("expiresAt" in params && params.expiresAt !== undefined) {
      data.expiresAt = params.expiresAt;
    }

    if ("revokedAt" in params) {
      data.revokedAt = params.revokedAt;
    }

    const shareLink = await client.shareLink.update({
      where: {
        id: params.id,
      },
      data,
      select: shareLinkSelect,
    });

    return toStoredShareLink(shareLink);
  },

  async deleteShare(shareId) {
    await client.shareLink.delete({
      where: {
        id: shareId,
      },
    });
  },
});

export const prismaSharingRepository = createPrismaSharingRepository();
