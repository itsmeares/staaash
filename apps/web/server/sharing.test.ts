import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSetupState: vi.fn().mockResolvedValue({ instanceName: "Staaash" }),
  },
}));

async function renderMarkup(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

import { ShareView } from "@/app/s/share-view";
import {
  canBrowseSharedFolder,
  createShareSchema,
  formatDateTimeLocalValue,
  getFolderArchiveDownloadAllowed,
  getSharedDownloadAllowed,
  getSharedViewerAllowed,
  getSharedTreeExposureMode,
  getSharingBoundary,
  unlockShareSchema,
  updateShareSchema,
} from "@/server/sharing";
import type { PublicShareResolution } from "@/server/sharing/types";

const fixedNow = new Date("2026-04-01T12:00:00.000Z");

const lockedFileResolution: PublicShareResolution = {
  kind: "file",
  share: {
    id: "share-1",
    createdByUserId: "user-1",
    targetType: "file",
    fileId: "file-1",
    folderId: null,
    shareUrl: "https://example.test/s/token",
    hasPassword: true,
    downloadDisabled: false,
    expiresAt: fixedNow,
    revokedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    status: "active",
    target: {
      targetType: "file",
      id: "file-1",
      ownerUserId: "user-1",
      ownerUsername: "alice",
      name: "plan.txt",
      folderId: "folder-1",
      mimeType: "text/plain",
      sizeBytes: 120,
      pathLabel: "Files / Projects / plan.txt",
      deletedAt: null,
    },
  },
  access: {
    requiresPassword: true,
    isUnlocked: false,
  },
  file: {
    id: "file-1",
    ownerUserId: "user-1",
    ownerUsername: "alice",
    folderId: "folder-1",
    name: "plan.txt",
    mimeType: "text/plain",
    sizeBytes: 120,
    viewerKind: null,
    deletedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  },
};

const lockedFolderResolution: PublicShareResolution = {
  kind: "folder",
  share: {
    id: "share-2",
    createdByUserId: "user-1",
    targetType: "folder",
    fileId: null,
    folderId: "folder-1",
    shareUrl: "https://example.test/s/token",
    hasPassword: true,
    downloadDisabled: false,
    expiresAt: fixedNow,
    revokedAt: null,
    createdAt: fixedNow,
    updatedAt: fixedNow,
    status: "active",
    target: {
      targetType: "folder",
      id: "folder-1",
      ownerUserId: "user-1",
      ownerUsername: "alice",
      name: "Projects",
      parentId: "root",
      isFilesRoot: false,
      pathLabel: "Files / Projects",
      deletedAt: null,
    },
  },
  access: {
    requiresPassword: true,
    isUnlocked: false,
  },
  listing: {
    rootFolder: {
      id: "folder-1",
      ownerUserId: "user-1",
      ownerUsername: "alice",
      parentId: "root",
      name: "Projects",
      isFilesRoot: false,
      deletedAt: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    },
    currentFolder: {
      id: "folder-2",
      ownerUserId: "user-1",
      ownerUsername: "alice",
      parentId: "folder-1",
      name: "2026",
      isFilesRoot: false,
      deletedAt: null,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    },
    breadcrumbs: [
      { id: "folder-1", name: "Projects", href: "/s/token" },
      { id: "folder-2", name: "2026", href: "/s/token/f/folder-2" },
    ],
    childFolders: [],
    files: [],
  },
};

describe("folder public link behavior", () => {
  it("allows traversal across the full linked subtree", () => {
    expect(
      canBrowseSharedFolder({
        rootFolderId: "root",
        requestedFolderId: "child",
        subtreeFolderIds: ["child", "grandchild"],
      }),
    ).toBe(true);
  });

  it("disables file and archive downloads when the policy disables downloads", () => {
    expect(getSharedDownloadAllowed({ downloadDisabled: true })).toBe(false);
    expect(getFolderArchiveDownloadAllowed({ downloadDisabled: true })).toBe(
      false,
    );
  });

  it("allows inline viewers even when downloads are disabled", () => {
    expect(getSharedViewerAllowed({ downloadDisabled: true })).toBe(true);
  });

  it("exposes the full subtree with no hidden child filtering", () => {
    expect(getSharedTreeExposureMode()).toBe("full-subtree");
    expect(getSharingBoundary()).toEqual({
      recipientsCanReshare: false,
      hiddenChildFiltering: false,
    });
  });

  it("round-trips datetime-local values without timezone drift", () => {
    const original = new Date(2026, 3, 1, 12, 30);
    const formatted = formatDateTimeLocalValue(original);
    const parsed = updateShareSchema.parse({
      expiresAt: formatted,
      downloadDisabled: "false",
    });

    expect(formatDateTimeLocalValue(parsed.expiresAt)).toBe(formatted);
  });

  it("requires a share id when reissuing a link", () => {
    expect(() =>
      createShareSchema.parse({
        mode: "reissue",
      }),
    ).toThrowError("A share ID is required to reissue a public link.");
  });

  it("rejects missing unlock passwords during validation", () => {
    expect(() => unlockShareSchema.parse({})).toThrow();
  });

  it("hides locked file metadata before unlock", async () => {
    const markup = await renderMarkup(
      createElement(ShareView, {
        resolution: lockedFileResolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain("Password required");
    expect(markup).not.toContain("plan.txt");
    expect(markup).not.toContain("text/plain");
  });

  it("hides locked folder metadata before unlock", async () => {
    const markup = await renderMarkup(
      createElement(ShareView, {
        resolution: lockedFolderResolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain("Password required");
    expect(markup).not.toContain("Projects");
    expect(markup).not.toContain("2026");
    expect(markup).not.toContain("Breadcrumb");
  });
});
