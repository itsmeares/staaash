import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { PublicShareResolution, ShareLinkSummary } from "./types";

const mocks = vi.hoisted(() => ({
  findReadyDerivative: vi.fn(),
  findReadyPosterDerivative: vi.fn(),
  getSetupState: vi.fn(),
  getSharedNestedFileContent: vi.fn(),
  resolvePublicShare: vi.fn(),
}));

vi.mock("@staaash/db/media-derivatives", () => ({
  findReadyDerivative: mocks.findReadyDerivative,
  findReadyPosterDerivative: mocks.findReadyPosterDerivative,
}));

vi.mock("@/server/auth/service", () => ({
  authService: {
    getSetupState: mocks.getSetupState,
  },
}));

vi.mock("@/server/sharing/service", () => ({
  sharingService: {
    getSharedNestedFileContent: mocks.getSharedNestedFileContent,
    resolvePublicShare: mocks.resolvePublicShare,
  },
}));

import { buildShareMetadata, getSharePageMetadata } from "./metadata";

const fixedNow = new Date("2026-05-31T12:00:00.000Z");

type OpenGraphImageForTest = {
  url: string;
  alt?: string;
  type?: string;
  width?: number;
  height?: number;
};

type OpenGraphForTest = {
  images?: OpenGraphImageForTest[];
  videos?: Array<{
    url: string;
    type?: string;
    width?: number;
    height?: number;
  }>;
  type?: string;
};

type TwitterForTest = {
  card?: string;
  images?: string[];
};

const makeFile = (overrides: Partial<FileSummary> = {}): FileSummary => ({
  id: "file-1",
  ownerUserId: "user-1",
  ownerStorageId: "alice",
  folderId: "folder-1",
  name: "photo.png",
  mimeType: "image/png",
  sizeBytes: 2_097_152,
  viewerKind: "image",
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  ...overrides,
});

const makeFolder = (overrides: Partial<FolderSummary> = {}): FolderSummary => ({
  id: "folder-1",
  ownerUserId: "user-1",
  ownerStorageId: "alice",
  parentId: null,
  name: "Photos",
  isFilesRoot: false,
  deletedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  ...overrides,
});

const makeShare = (
  overrides: Partial<ShareLinkSummary> = {},
): ShareLinkSummary => ({
  id: "share-1",
  createdByUserId: "user-1",
  targetType: "file",
  fileId: "file-1",
  folderId: null,
  shareUrl: "https://files.example/s/token",
  hasPassword: false,
  downloadDisabled: false,
  expiresAt: new Date("2026-06-30T12:00:00.000Z"),
  revokedAt: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  status: "active",
  target: {
    targetType: "file",
    id: "file-1",
    ownerUserId: "user-1",
    ownerStorageId: "alice",
    name: "photo.png",
    folderId: "folder-1",
    mimeType: "image/png",
    sizeBytes: 2_097_152,
    pathLabel: "Files / photo.png",
    deletedAt: null,
  },
  ...overrides,
});

const makeFileResolution = (
  overrides: Partial<PublicShareResolution & { file: FileSummary }> = {},
): PublicShareResolution => {
  const file = overrides.file ?? makeFile();
  return {
    kind: "file",
    share: overrides.share ?? makeShare(),
    access: overrides.access ?? {
      requiresPassword: false,
      isUnlocked: true,
    },
    file,
  };
};

const makeFolderResolution = (
  overrides: Partial<PublicShareResolution> = {},
): PublicShareResolution => {
  const folder = makeFolder();
  return {
    kind: "folder",
    share:
      overrides.share ??
      makeShare({
        targetType: "folder",
        fileId: null,
        folderId: folder.id,
        target: {
          targetType: "folder",
          id: folder.id,
          ownerUserId: "user-1",
          ownerStorageId: "alice",
          name: folder.name,
          parentId: null,
          isFilesRoot: false,
          pathLabel: "Files / Photos",
          deletedAt: null,
        },
      }),
    access: overrides.access ?? {
      requiresPassword: false,
      isUnlocked: true,
    },
    listing: {
      rootFolder: folder,
      currentFolder: folder,
      breadcrumbs: [],
      childFolders: [],
      files: [],
    },
  };
};

describe("share metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSetupState.mockResolvedValue({ instanceName: "Ares Cloud" });
    mocks.findReadyDerivative.mockResolvedValue(null);
    mocks.findReadyPosterDerivative.mockResolvedValue(null);
  });

  it("emits absolute Open Graph and Twitter image URLs for image shares", () => {
    const metadata = buildShareMetadata({
      baseUrl: "https://files.example",
      instanceName: "Ares Cloud",
      target: {
        kind: "file",
        pagePath: "/s/token",
        contentPath: "/s/token/content",
        file: makeFile(),
        videoEmbedMetadata: null,
      },
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;
    const twitter = metadata.twitter as TwitterForTest;

    expect(openGraph.images).toEqual([
      {
        url: "https://files.example/s/token/content",
        alt: "photo.png",
      },
    ]);
    expect(twitter).toMatchObject({
      card: "summary_large_image",
      images: ["https://files.example/s/token/content"],
    });
  });

  it("emits Open Graph video when a ready MP4 derivative exists", () => {
    const metadata = buildShareMetadata({
      baseUrl: "https://files.example",
      instanceName: "Ares Cloud",
      target: {
        kind: "file",
        pagePath: "/s/token",
        contentPath: "/s/token/content",
        file: makeFile({
          name: "clip.mkv",
          mimeType: "video/x-matroska",
          viewerKind: "video",
        }),
        videoEmbedMetadata: {
          type: "video/mp4",
          width: 1920,
          height: 1080,
        },
      },
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;

    expect(openGraph.type).toBe("video.other");
    expect(openGraph.videos).toEqual([
      {
        url: "https://files.example/s/token/content",
        type: "video/mp4",
        width: 1920,
        height: 1080,
      },
    ]);
  });

  it("emits Open Graph video with fallback dimensions for broadly playable original videos", () => {
    const metadata = buildShareMetadata({
      baseUrl: "https://files.example",
      instanceName: "Ares Cloud",
      target: {
        kind: "file",
        pagePath: "/s/token",
        contentPath: "/s/token/content",
        file: makeFile({
          name: "clip.mp4",
          mimeType: "video/mp4",
          viewerKind: "video",
        }),
        videoEmbedMetadata: null,
      },
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;

    expect(openGraph.videos).toEqual([
      {
        url: "https://files.example/s/token/content",
        type: "video/mp4",
        width: 1280,
        height: 720,
      },
    ]);
  });

  it("uses ready derivative dimensions for resolved video shares", async () => {
    mocks.resolvePublicShare.mockResolvedValue(
      makeFileResolution({
        file: makeFile({
          name: "clip.mkv",
          mimeType: "video/x-matroska",
          viewerKind: "video",
        }),
      }),
    );
    mocks.findReadyDerivative.mockResolvedValue({
      storageKey: "derivatives/user-1/file-1/preview-1080p.mp4",
      mimeType: "video/mp4",
      width: 1440,
      height: 810,
    });

    const metadata = await getSharePageMetadata({
      baseUrl: "https://files.example",
      token: "token",
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;

    expect(openGraph.videos).toEqual([
      {
        url: "https://files.example/s/token/content",
        type: "video/mp4",
        width: 1440,
        height: 810,
      },
    ]);
  });

  it("emits poster image metadata for resolved video shares", async () => {
    mocks.resolvePublicShare.mockResolvedValue(
      makeFileResolution({
        file: makeFile({
          name: "clip.mp4",
          mimeType: "video/mp4",
          viewerKind: "video",
        }),
      }),
    );
    mocks.findReadyPosterDerivative.mockResolvedValue({
      storageKey: "derivatives/user-1/file-1/social-poster.jpg",
      mimeType: "image/jpeg",
      width: 1280,
      height: 720,
    });

    const metadata = await getSharePageMetadata({
      baseUrl: "https://files.example",
      token: "token",
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;
    const twitter = metadata.twitter as TwitterForTest;

    expect(openGraph.images).toEqual([
      {
        url: "https://files.example/s/token/poster",
        alt: "clip.mp4",
        type: "image/jpeg",
        width: 1280,
        height: 720,
      },
    ]);
    expect(twitter).toMatchObject({
      card: "summary_large_image",
      images: ["https://files.example/s/token/poster"],
    });
  });

  it("does not emit Open Graph video for non-playable video without derivative", () => {
    const metadata = buildShareMetadata({
      baseUrl: "https://files.example",
      instanceName: "Ares Cloud",
      target: {
        kind: "file",
        pagePath: "/s/token",
        contentPath: "/s/token/content",
        file: makeFile({
          name: "clip.mkv",
          mimeType: "video/x-matroska",
          viewerKind: "video",
        }),
        videoEmbedMetadata: null,
      },
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;

    expect(openGraph.type).toBe("website");
    expect(openGraph.videos).toBeUndefined();
  });

  it("hides passworded share details from metadata", async () => {
    mocks.resolvePublicShare.mockResolvedValue(
      makeFileResolution({
        share: makeShare({ hasPassword: true }),
        access: {
          requiresPassword: true,
          isUnlocked: false,
        },
      }),
    );

    const metadata = await getSharePageMetadata({
      baseUrl: "https://files.example",
      token: "secret-token",
    });

    expect(metadata.title).toBe("Ares Cloud share");
    expect(JSON.stringify(metadata)).not.toContain("photo.png");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("returns generic noindex metadata for invalid shares", async () => {
    mocks.resolvePublicShare.mockRejectedValue(new Error("missing"));

    const metadata = await getSharePageMetadata({
      baseUrl: "https://files.example",
      token: "missing-token",
    });

    expect(metadata.title).toBe("Ares Cloud share");
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("emits folder card metadata without child media previews", () => {
    const metadata = buildShareMetadata({
      baseUrl: "https://files.example",
      instanceName: "Ares Cloud",
      target: {
        kind: "folder",
        pagePath: "/s/token",
        folderName: "Photos",
      },
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;

    expect(metadata.title).toBe("Photos - Ares Cloud");
    expect(openGraph.images).toBeUndefined();
    expect(openGraph.videos).toBeUndefined();
  });

  it("emits nested shared file metadata from folder shares", async () => {
    mocks.resolvePublicShare.mockResolvedValue(makeFolderResolution());
    mocks.getSharedNestedFileContent.mockResolvedValue({
      file: makeFile({
        id: "nested-file",
        name: "nested-photo.jpg",
        mimeType: "image/jpeg",
      }),
    });

    const metadata = await getSharePageMetadata({
      baseUrl: "https://files.example",
      token: "folder-token",
      fileId: "nested-file",
    });

    const openGraph = metadata.openGraph as OpenGraphForTest;

    expect(metadata.title).toBe("nested-photo.jpg - Ares Cloud");
    expect(openGraph.images?.[0]?.url).toBe(
      "https://files.example/s/folder-token/files/nested-file/content",
    );
  });
});
