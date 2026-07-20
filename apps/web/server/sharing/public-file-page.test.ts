import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { PublicShareResolution } from "@/server/sharing/types";

const mocks = vi.hoisted(() => ({
  getPublicShareFilePreview: vi.fn(),
  getSharedNestedFileContent: vi.fn(),
  resolvePublicShare: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSetupState: vi.fn().mockResolvedValue({ instanceName: "Staaash" }),
  },
}));

vi.mock("@/server/sharing/metadata", () => ({
  getSharePageMetadata: vi.fn(),
}));

vi.mock("@/server/sharing/public-file-preview", () => ({
  getPublicShareFilePreview: mocks.getPublicShareFilePreview,
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    getSharedNestedFileContent: mocks.getSharedNestedFileContent,
    resolvePublicShare: mocks.resolvePublicShare,
  },
}));

import SharedRootPage from "@/app/s/[token]/page";
import SharedNestedFilePage from "@/app/s/[token]/files/[fileId]/page";

const fixedNow = new Date("2026-07-20T12:00:00.000Z");

const videoFile: FileSummary = {
  id: "video-1",
  ownerUserId: "member-1",
  ownerStorageId: "member-1",
  folderId: "folder-1",
  name: "source.mov",
  mimeType: "video/quicktime",
  sizeBytes: 10,
  viewerKind: "video",
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const rootFolder: FolderSummary = {
  id: "folder-1",
  ownerUserId: "member-1",
  ownerStorageId: "member-1",
  parentId: "root",
  name: "Shared",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
};

const share = {
  id: "share-1",
  createdByUserId: "member-1",
  targetType: "file" as const,
  fileId: videoFile.id,
  folderId: null,
  shareUrl: "https://example.test/s/token",
  hasPassword: false,
  downloadDisabled: false,
  expiresAt: new Date("2026-08-20T12:00:00.000Z"),
  revokedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  status: "active" as const,
  target: {
    targetType: "file" as const,
    id: videoFile.id,
    ownerUserId: videoFile.ownerUserId,
    ownerStorageId: videoFile.ownerStorageId,
    name: videoFile.name,
    folderId: videoFile.folderId,
    mimeType: videoFile.mimeType,
    sizeBytes: videoFile.sizeBytes,
    pathLabel: "Files / source.mov",
    deletedAt: null,
  },
};

const directResolution: PublicShareResolution = {
  kind: "file",
  share,
  access: { requiresPassword: false, isUnlocked: true },
  file: videoFile,
};

const folderResolution: PublicShareResolution = {
  kind: "folder",
  share: {
    ...share,
    targetType: "folder",
    fileId: null,
    folderId: rootFolder.id,
    downloadDisabled: true,
    target: {
      targetType: "folder",
      id: rootFolder.id,
      ownerUserId: rootFolder.ownerUserId,
      ownerStorageId: rootFolder.ownerStorageId,
      name: rootFolder.name,
      parentId: rootFolder.parentId,
      isFilesRoot: rootFolder.isFilesRoot,
      pathLabel: "Files / Shared",
      deletedAt: null,
    },
  },
  access: { requiresPassword: false, isUnlocked: true },
  listing: {
    rootFolder,
    currentFolder: rootFolder,
    breadcrumbs: [
      { id: rootFolder.id, name: rootFolder.name, href: "/s/token" },
    ],
    childFolders: [],
    files: [videoFile],
  },
};

async function renderMarkup(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

describe("public shared file pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicShareFilePreview.mockResolvedValue({
      safeInlineMimeType: "video/mp4",
    });
  });

  it("passes ready safe video preview metadata to a direct file share", async () => {
    mocks.resolvePublicShare.mockResolvedValue(directResolution);

    const page = await SharedRootPage({
      params: Promise.resolve({ token: "token" }),
      searchParams: Promise.resolve({}),
    });
    const markup = await renderMarkup(createElement(() => page));

    expect(mocks.getPublicShareFilePreview).toHaveBeenCalledWith(videoFile);
    expect(markup).toContain("<video");
    expect(markup).toContain('src="/s/token/content"');
    expect(markup).not.toContain("derivatives/");
  });

  it("passes the same minimal metadata through a nested folder share", async () => {
    mocks.resolvePublicShare.mockResolvedValue(folderResolution);
    mocks.getSharedNestedFileContent.mockResolvedValue({
      file: videoFile,
      downloadDisabled: true,
    });

    const page = await SharedNestedFilePage({
      params: Promise.resolve({ token: "token", fileId: videoFile.id }),
      searchParams: Promise.resolve({}),
    });
    const markup = await renderMarkup(createElement(() => page));

    expect(mocks.getPublicShareFilePreview).toHaveBeenCalledWith(videoFile);
    expect(markup).toContain("<video");
    expect(markup).toContain('src="/s/token/files/video-1/content"');
    expect(markup).toContain("Downloads off");
    expect(markup).not.toContain("derivatives/");
  });
});
