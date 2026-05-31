import { beforeEach, describe, expect, it, vi } from "vitest";

const derivativeMocks = vi.hoisted(() => ({
  findReadyDerivative: vi.fn(),
  scheduleDerivativeGenerate: vi.fn(),
  touchDerivativeShared: vi.fn(),
}));
const settingsMocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@staaash/db/media-derivatives", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@staaash/db/media-derivatives")>();
  return {
    ...actual,
    findReadyDerivative: derivativeMocks.findReadyDerivative,
    scheduleDerivativeGenerate: derivativeMocks.scheduleDerivativeGenerate,
    touchDerivativeShared: derivativeMocks.touchDerivativeShared,
  };
});

vi.mock("@/server/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/settings")>();
  return {
    ...actual,
    getSystemSettings: settingsMocks.getSystemSettings,
  };
});

import { buildShareAccessCookie } from "@/server/sharing/access-cookie";
import { ShareError } from "@/server/sharing/errors";
import { createSharingService } from "@/server/sharing/service";
import type { SharingRepository } from "@/server/sharing/repository";
import type { StoredShareLink } from "@/server/sharing/types";
import type { FilesRepository } from "@/server/files/repository";
import type { FolderSummary, StoredFile } from "@/server/files/types";

const fixedNow = new Date("2026-04-01T12:00:00.000Z");

const addDays = (days: number) =>
  new Date(fixedNow.getTime() + days * 24 * 60 * 60 * 1000);

const filesRoot: FolderSummary = {
  id: "root",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  parentId: null,
  name: "Files",
  isFilesRoot: true,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const sharedFolder: FolderSummary = {
  id: "folder-shared",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  parentId: "root",
  name: "Projects",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const childFolder: FolderSummary = {
  id: "folder-child",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  parentId: "folder-shared",
  name: "2026",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const siblingFolder: FolderSummary = {
  id: "folder-sibling",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  parentId: "root",
  name: "Private",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const sharedFile: StoredFile = {
  id: "file-shared",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  folderId: "folder-shared",
  name: "plan.txt",
  storageKey: "files/alice/Projects/plan.txt",
  storageStatus: "available",
  storageCheckedAt: null,
  storageMissingAt: null,
  mimeType: "text/plain",
  sizeBytes: 120,
  contentChecksum: "abc",
  viewerKind: null,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const childFile: StoredFile = {
  id: "file-child",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  folderId: "folder-child",
  name: "notes.txt",
  storageKey: "files/alice/Projects/2026/notes.txt",
  storageStatus: "available",
  storageCheckedAt: null,
  storageMissingAt: null,
  mimeType: "text/plain",
  sizeBytes: 220,
  contentChecksum: "def",
  viewerKind: null,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const smallVideoFile: StoredFile = {
  id: "file-small-video",
  ownerUserId: "user-1",
  ownerUsername: "alice",
  folderId: "folder-shared",
  name: "clip.mp4",
  storageKey: "files/alice/Projects/clip.mp4",
  storageStatus: "available",
  storageCheckedAt: null,
  storageMissingAt: null,
  mimeType: "video/mp4",
  sizeBytes: 13 * 1024 * 1024,
  contentChecksum: "video",
  viewerKind: "video",
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const createFakeSharingRepository = () => {
  const state: StoredShareLink[] = [];

  const repo: SharingRepository = {
    async findShareById(shareId) {
      return state.find((share) => share.id === shareId) ?? null;
    },
    async findShareByFileId(fileId) {
      return state.find((share) => share.fileId === fileId) ?? null;
    },
    async findShareByFolderId(folderId) {
      return state.find((share) => share.folderId === folderId) ?? null;
    },
    async findShareByTokenLookupKey(tokenLookupKey) {
      return (
        state.find((share) => share.tokenLookupKey === tokenLookupKey) ?? null
      );
    },
    async listSharesByCreator(createdByUserId) {
      return state.filter((share) => share.createdByUserId === createdByUserId);
    },
    async saveShareForTarget(params) {
      const existing =
        params.targetType === "file"
          ? state.find((share) => share.fileId === params.fileId)
          : state.find((share) => share.folderId === params.folderId);

      if (existing) {
        existing.tokenLookupKey = params.tokenLookupKey;
        existing.tokenHash = params.tokenHash;
        existing.passwordHash = params.passwordHash;
        existing.downloadDisabled = params.downloadDisabled;
        existing.expiresAt = params.expiresAt;
        existing.revokedAt = params.revokedAt ?? null;
        existing.updatedAt = fixedNow;
        return existing;
      }

      return repo.createShare(params);
    },
    async createShare(params) {
      const share: StoredShareLink = {
        id: `share-${state.length + 1}`,
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
        createdAt: fixedNow,
        updatedAt: fixedNow,
      };
      state.push(share);
      return share;
    },
    async updateShare(params) {
      const share = state.find((candidate) => candidate.id === params.id);

      if (!share) {
        throw new Error("Share not found");
      }

      if ("tokenLookupKey" in params && params.tokenLookupKey !== undefined) {
        share.tokenLookupKey = params.tokenLookupKey;
      }

      if ("tokenHash" in params && params.tokenHash !== undefined) {
        share.tokenHash = params.tokenHash;
      }

      if ("passwordHash" in params) {
        share.passwordHash = params.passwordHash ?? null;
      }

      if (
        "downloadDisabled" in params &&
        params.downloadDisabled !== undefined
      ) {
        share.downloadDisabled = params.downloadDisabled;
      }

      if ("expiresAt" in params && params.expiresAt !== undefined) {
        share.expiresAt = params.expiresAt;
      }

      if ("revokedAt" in params) {
        share.revokedAt = params.revokedAt ?? null;
      }

      share.updatedAt = fixedNow;
      return share;
    },
    async deleteShare(shareId) {
      const index = state.findIndex((share) => share.id === shareId);

      if (index >= 0) {
        state.splice(index, 1);
      }
    },
  };

  return {
    repo,
    state,
  };
};

const fakeFilesRepo = {
  async ensureFilesRoot() {
    return filesRoot;
  },
  async findFolderById(folderId: string) {
    return (
      [filesRoot, sharedFolder, childFolder, siblingFolder].find(
        (folder) => folder.id === folderId,
      ) ?? null
    );
  },
  async findFileById(fileId: string) {
    return (
      [sharedFile, childFile].find(
        (file) => file.id === fileId && file.storageStatus === "available",
      ) ?? null
    );
  },
  async listFoldersByOwner() {
    return [filesRoot, sharedFolder, childFolder, siblingFolder];
  },
  async listFilesByOwner() {
    return [sharedFile, childFile].filter(
      (file) => file.storageStatus === "available",
    );
  },
} as unknown as FilesRepository;

const waitForAssertion = async (assertion: () => void) => {
  let lastError: unknown;

  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  throw lastError;
};

describe("sharing service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsMocks.getSystemSettings.mockResolvedValue({
      mediaPreviewEnabled: true,
      mediaPreviewThresholdBytes: 367001600n,
    });
    derivativeMocks.findReadyDerivative.mockResolvedValue(null);
    derivativeMocks.scheduleDerivativeGenerate.mockResolvedValue({ id: "job" });
    derivativeMocks.touchDerivativeShared.mockResolvedValue(undefined);
  });

  it("creates and reissues singleton links for the same target", async () => {
    const sharingRepo = createFakeSharingRepository();
    const service = createSharingService({
      repo: sharingRepo.repo,
      filesRepo: fakeFilesRepo,
      now: () => fixedNow,
    });

    const created = await service.createOrReissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      targetType: "file",
      fileId: sharedFile.id,
      expiresAt: addDays(7),
    });
    const originalTokenLookupKey = created.share.tokenLookupKey;
    const originalShareUrl = created.shareUrl;
    const reissued = await service.createOrReissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      targetType: "file",
      fileId: sharedFile.id,
      expiresAt: addDays(8),
    });

    expect(sharingRepo.state).toHaveLength(1);
    expect(reissued.share.id).toBe(created.share.id);
    expect(reissued.share.tokenLookupKey).not.toBe(originalTokenLookupKey);
    expect(reissued.shareUrl).not.toBe(originalShareUrl);
  });

  it("requires password unlock and invalidates access after password rotation", async () => {
    const sharingRepo = createFakeSharingRepository();
    const service = createSharingService({
      repo: sharingRepo.repo,
      filesRepo: fakeFilesRepo,
      now: () => fixedNow,
    });

    const created = await service.createOrReissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      targetType: "folder",
      folderId: sharedFolder.id,
      expiresAt: addDays(5),
      password: "secret-pass",
    });
    const resolvedBeforeUnlock = await service.resolvePublicShare({
      token: created.token,
    });

    expect(resolvedBeforeUnlock.access.requiresPassword).toBe(true);
    expect(resolvedBeforeUnlock.access.isUnlocked).toBe(false);

    const unlocked = await service.unlockShare({
      token: created.token,
      password: "secret-pass",
    });
    const cookie = buildShareAccessCookie({
      shareId: unlocked.share.id,
      tokenLookupKey: unlocked.share.tokenLookupKey,
      accessFingerprint: unlocked.accessFingerprint,
      token: created.token,
    });
    const resolvedAfterUnlock = await service.resolvePublicShare({
      token: created.token,
      shareAccessCookieValue: cookie.value,
    });

    expect(resolvedAfterUnlock.access.isUnlocked).toBe(true);

    await service.updateSharePassword({
      actorUserId: "user-1",
      actorRole: "member",
      shareId: unlocked.share.id,
      password: "next-secret-pass",
    });

    const resolvedAfterRotation = await service.resolvePublicShare({
      token: created.token,
      shareAccessCookieValue: cookie.value,
    });

    expect(resolvedAfterRotation.access.isUnlocked).toBe(false);
  });

  it("reissues inactive shares without dropping password or expiry policy", async () => {
    const sharingRepo = createFakeSharingRepository();
    const service = createSharingService({
      repo: sharingRepo.repo,
      filesRepo: fakeFilesRepo,
      now: () => fixedNow,
    });
    const created = await service.createOrReissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      targetType: "folder",
      folderId: sharedFolder.id,
      expiresAt: addDays(5),
      downloadDisabled: true,
      password: "secret-pass",
    });

    await service.revokeShare({
      actorUserId: "user-1",
      actorRole: "member",
      shareId: created.share.id,
    });
    const originalTokenLookupKey = created.share.tokenLookupKey;

    const reissued = await service.reissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      shareId: created.share.id,
    });

    expect(reissued.share.id).toBe(created.share.id);
    expect(reissued.share.tokenLookupKey).not.toBe(originalTokenLookupKey);
    expect(reissued.share.passwordHash).toBe(created.share.passwordHash);
    expect(reissued.share.downloadDisabled).toBe(true);
    expect(reissued.share.expiresAt.toISOString()).toBe(
      created.share.expiresAt.toISOString(),
    );
    expect(reissued.share.revokedAt).toBeNull();
  });

  it("blocks browsing outside the shared subtree", async () => {
    const sharingRepo = createFakeSharingRepository();
    const service = createSharingService({
      repo: sharingRepo.repo,
      filesRepo: fakeFilesRepo,
      now: () => fixedNow,
    });
    const created = await service.createOrReissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      targetType: "folder",
      folderId: sharedFolder.id,
      expiresAt: addDays(5),
    });

    await expect(
      service.resolvePublicShare({
        token: created.token,
        requestedFolderId: siblingFolder.id,
      }),
    ).rejects.toMatchObject({
      code: "SHARE_ACCESS_DENIED",
    });
  });

  it("schedules a social poster for small shared videos below preview threshold", async () => {
    const sharingRepo = createFakeSharingRepository();
    const videoFilesRepo = {
      ...fakeFilesRepo,
      async findFileById(fileId: string) {
        if (fileId === smallVideoFile.id) return smallVideoFile;
        return fakeFilesRepo.findFileById(fileId);
      },
    } as unknown as FilesRepository;
    const service = createSharingService({
      repo: sharingRepo.repo,
      filesRepo: videoFilesRepo,
      now: () => fixedNow,
    });

    await service.createOrReissueShare({
      actorUserId: "user-1",
      actorRole: "member",
      targetType: "file",
      fileId: smallVideoFile.id,
      expiresAt: addDays(7),
    });

    await waitForAssertion(() => {
      expect(derivativeMocks.scheduleDerivativeGenerate).toHaveBeenCalledWith({
        fileId: smallVideoFile.id,
        kind: "poster",
        profile: "social-jpeg",
        reason: "share-created",
        now: fixedNow,
      });
    });
    expect(derivativeMocks.scheduleDerivativeGenerate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: smallVideoFile.id,
        kind: "preview",
      }),
    );
    expect(derivativeMocks.touchDerivativeShared).toHaveBeenCalledWith(
      smallVideoFile.id,
      "poster",
      "social-jpeg",
      fixedNow,
    );
  });
});
