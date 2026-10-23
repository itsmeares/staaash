import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSetupState: vi.fn(),
  getRequestSession: vi.fn(),
  getSystemSettings: vi.fn(),
  getUpdateState: vi.fn(),
  getFilesListing: vi.fn(),
  resolvePublicShare: vi.fn(),
  getPublicShareFilePreview: vi.fn(),
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSession: mocks.getSession,
    getSetupState: mocks.getSetupState,
  },
}));
vi.mock("@/server/auth/guards", () => ({
  getRequestSession: mocks.getRequestSession,
}));
vi.mock("@/server/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/settings")>()),
  getSystemSettings: mocks.getSystemSettings,
}));
vi.mock("@/server/admin/updates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/admin/updates")>()),
  getUpdateState: mocks.getUpdateState,
}));
vi.mock("@/server/user-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/user-storage")>()),
  getInstanceDiskInfo: vi.fn(async () => null),
  getUserStorageUsed: vi.fn(async () => ({ usedBytes: 0n })),
}));
vi.mock("@/server/files/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/files/service")>()),
  filesService: { getFilesListing: mocks.getFilesListing },
}));
vi.mock("@/server/sharing/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/sharing/service")>()),
  sharingService: { resolvePublicShare: mocks.resolvePublicShare },
}));
vi.mock("@/server/sharing/public-file-preview", () => ({
  getPublicShareFilePreview: mocks.getPublicShareFilePreview,
}));

import { createApp } from "@/server/http/core";
import { viewRoutes } from "@/server/http/routes/views";
import { StorageEntityUnavailableError } from "@/server/storage-read-guard";

const app = createApp().route("/", viewRoutes);
const get = (path: string) =>
  app.request(`http://localhost${path}`, {
    headers: { accept: "application/json", cookie: "staaash_session=token" },
  });

const now = new Date("2026-09-01T12:00:00.000Z");
const user = (overrides: Record<string, unknown> = {}) => ({
  id: "user-1",
  email: "member@example.test",
  displayName: "Mia",
  avatarUrl: null,
  isOwner: false,
  isAdmin: false,
  role: "member",
  passwordChangeRequiredAt: null,
  storageLimitBytes: null,
  preferences: {
    onboardingCompletedAt: now,
    startPage: "home",
    showPinsInSidebar: false,
  },
  ...overrides,
});

const storageBusy = () =>
  new StorageEntityUnavailableError({
    id: "mutation-1",
    kind: "file_move",
    status: "retrying",
  });

describe("view routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetupState.mockResolvedValue({
      isBootstrapped: true,
      instanceName: "Home Drive",
    });
    mocks.getSystemSettings.mockResolvedValue({
      mediaPreviewEnabled: true,
      mediaPreviewGenerateOnUpload: false,
      mediaPreviewGenerateOnFirstView: true,
      mediaPreviewGenerateOnShare: true,
    });
  });

  describe("entry", () => {
    it("starts setup on a new instance", async () => {
      mocks.getSetupState.mockResolvedValue({
        isBootstrapped: false,
        instanceName: null,
      });
      mocks.getSession.mockResolvedValue(null);

      await expect((await get("/api/views/entry")).json()).resolves.toEqual({
        state: "setup",
        instanceName: "Staaash",
      });
    });

    it("sends an onboarded person to their start page", async () => {
      mocks.getSession.mockResolvedValue({ user: user() });

      await expect(
        (await get("/api/views/entry")).json(),
      ).resolves.toMatchObject({
        state: "signed-in",
        firstRun: null,
        startPage: "home",
      });
    });

    it.each([
      ["a new member", { preferences: null }, "member"],
      [
        "an owner who made the account",
        { preferences: null, isOwner: true },
        "owner",
      ],
      [
        "a member with a temporary password",
        { preferences: null, passwordChangeRequiredAt: now },
        "member-password",
      ],
      [
        "someone whose password an owner reset",
        { passwordChangeRequiredAt: now },
        "password",
      ],
    ])("gives %s the right first-run steps", async (_name, overrides, kind) => {
      mocks.getSession.mockResolvedValue({ user: user(overrides) });

      await expect(
        (await get("/api/views/entry")).json(),
      ).resolves.toMatchObject({ state: "signed-in", firstRun: kind });
    });
  });

  describe("shell", () => {
    it("loads update news for owners and not for members", async () => {
      mocks.getUpdateState.mockResolvedValue({ status: "current" });
      mocks.getRequestSession.mockResolvedValueOnce({
        id: "s1",
        user: user({ isAdmin: true, isOwner: true, role: "owner" }),
      });
      const owner = await (await get("/api/views/shell")).json();
      expect(owner.updateState).toEqual({ status: "current" });

      mocks.getRequestSession.mockResolvedValueOnce({ id: "s2", user: user() });
      const member = await (await get("/api/views/shell")).json();
      expect(member.updateState).toBeNull();
      expect(mocks.getUpdateState).toHaveBeenCalledTimes(1);
    });

    it("refuses signed-out callers", async () => {
      mocks.getRequestSession.mockResolvedValueOnce(null);
      expect((await get("/api/views/shell")).status).toBe(401);
    });
  });

  describe("storage changes", () => {
    beforeEach(() => {
      mocks.getRequestSession.mockResolvedValue({ id: "s1", user: user() });
    });

    it("answers 503 for a folder in the middle of a change", async () => {
      mocks.getFilesListing.mockRejectedValue(storageBusy());

      const response = await get("/api/views/files/folder-1");

      expect(response.status).toBe(503);
      expect(response.headers.get("X-Storage-Mutation-Id")).toBe("mutation-1");
      await expect(response.json()).resolves.toMatchObject({
        code: "STORAGE_MUTATION_RECOVERING",
      });
    });

    it("tells the waiting page whether the folder is readable yet", async () => {
      mocks.getFilesListing.mockRejectedValueOnce(storageBusy());
      await expect(
        (await get("/api/views/storage-unavailable/folder-1")).json(),
      ).resolves.toEqual({ available: false, recoveryRequired: false });

      mocks.getFilesListing.mockResolvedValueOnce({
        currentFolder: { isFilesRoot: false },
      });
      await expect(
        (await get("/api/views/storage-unavailable/folder-1")).json(),
      ).resolves.toEqual({ available: true, isFilesRoot: false });
    });
  });

  describe("share pages", () => {
    const videoFile = {
      id: "video-1",
      ownerUserId: "user-1",
      ownerStorageId: "alice",
      folderId: null,
      name: "clip.mov",
      mimeType: "video/quicktime",
      sizeBytes: 10,
      viewerKind: "video",
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    it("answers 503 for a shared item in the middle of a change", async () => {
      mocks.resolvePublicShare.mockRejectedValue(storageBusy());

      const response = await get("/s/token/view");

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "STORAGE_MUTATION_RECOVERING",
      });
    });

    it("lets a video play inline only through its safe preview", async () => {
      mocks.resolvePublicShare.mockResolvedValue({
        kind: "file",
        share: { status: "active", downloadDisabled: false, expiresAt: now },
        access: { requiresPassword: false, isUnlocked: true },
        file: videoFile,
      });
      mocks.getPublicShareFilePreview.mockResolvedValueOnce({
        safeInlineMimeType: "video/mp4",
      });
      await expect((await get("/s/token/view")).json()).resolves.toMatchObject({
        kind: "share",
        nativeInline: true,
      });

      mocks.getPublicShareFilePreview.mockResolvedValueOnce(null);
      await expect((await get("/s/token/view")).json()).resolves.toMatchObject({
        kind: "share",
        nativeInline: false,
      });
    });

    it("tells visitors only what the page shows", async () => {
      const share = {
        status: "active",
        downloadDisabled: false,
        expiresAt: now,
        createdByUserId: "user-1",
        shareUrl: "https://drive.example/s/secret",
      };
      mocks.resolvePublicShare.mockResolvedValueOnce({
        kind: "file",
        share,
        access: { requiresPassword: true, isUnlocked: false },
        file: videoFile,
      });
      const locked = await (await get("/s/token/view")).json();
      expect(locked.resolution).toEqual({ kind: "locked" });

      mocks.getPublicShareFilePreview.mockResolvedValueOnce(null);
      mocks.resolvePublicShare.mockResolvedValueOnce({
        kind: "file",
        share,
        access: { requiresPassword: false, isUnlocked: true },
        file: videoFile,
      });
      const open = JSON.stringify(await (await get("/s/token/view")).json());
      for (const secret of ["user-1", "alice", "drive.example"]) {
        expect(open).not.toContain(secret);
      }
    });

    it("hides why a dead link is dead", async () => {
      const { ShareError } = await import("@/server/sharing/errors");
      mocks.resolvePublicShare.mockRejectedValue(
        new ShareError("SHARE_EXPIRED"),
      );

      await expect((await get("/s/token/view")).json()).resolves.toMatchObject({
        kind: "error",
        error: { code: "SHARE_EXPIRED" },
      });
    });
  });
});
