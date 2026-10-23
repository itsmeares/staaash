import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

async function renderMarkup(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(
    createElement(QueryClientProvider, {
      client: new QueryClient(),
      children: createElement(TimeProvider, { timeZone: "UTC", children: element }),
    }),
  );
  await stream.allReady;
  return new Response(stream).text();
}

/** The share page as the browser gets it: JSON data and the server's inline decision. */
const shareElement = ({
  filePreview = null,
  resolution,
  token,
}: {
  filePreview?: PublicShareFilePreview | null;
  resolution: PublicShareResolution;
  searchParams?: unknown;
  token: string;
}) =>
  createElement(ShareView, {
    folderSizeBytes: 0,
    nativeInline:
      resolution.kind === "file" &&
      isPublicShareFileNativeViewSafe(resolution.file, filePreview),
    resolution: plain(toPublicShareView(resolution)),
    token,
  });

import { ShareView } from "@/src/share/share-view";
import { TimeProvider } from "@/components/time-provider";
import {
  canBrowseSharedFolder,
  getFolderArchiveDownloadAllowed,
  getSharedDownloadAllowed,
  getSharedViewerAllowed,
  getSharedTreeExposureMode,
  getSharingBoundary,
} from "@/server/sharing";
import type {
  PublicShareFilePreview,
  PublicShareResolution,
} from "@/server/sharing/types";
import { plain } from "@/lib/plain";
import { toPublicShareView } from "@/server/sharing/public-view";
import { isPublicShareFileNativeViewSafe } from "@/server/media/public-share-content-policy";

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
      ownerStorageId: "alice",
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
    ownerStorageId: "alice",
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
      ownerStorageId: "alice",
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
      ownerStorageId: "alice",
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
      ownerStorageId: "alice",
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

const makeUnlockedFileResolution = ({
  downloadDisabled = false,
  mimeType,
  name,
  viewerKind,
}: {
  downloadDisabled?: boolean;
  mimeType: string;
  name: string;
  viewerKind: "audio" | "image" | "pdf" | "text" | "video" | null;
}): PublicShareResolution => ({
  ...lockedFileResolution,
  share: {
    ...lockedFileResolution.share,
    hasPassword: false,
    downloadDisabled,
  },
  access: {
    requiresPassword: false,
    isUnlocked: true,
  },
  file: {
    ...lockedFileResolution.file,
    mimeType,
    name,
    viewerKind,
  },
});

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

  it("hides locked file metadata before unlock", async () => {
    const markup = await renderMarkup(
      shareElement({
        resolution: lockedFileResolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain("data-share-locked");
    expect(markup).not.toContain("plan.txt");
    expect(markup).not.toContain("text/plain");
  });

  it("hides locked folder metadata before unlock", async () => {
    const markup = await renderMarkup(
      shareElement({
        resolution: lockedFolderResolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain("data-share-locked");
    expect(markup).not.toContain("Projects");
    expect(markup).not.toContain("2026");
    expect(markup).not.toContain("Breadcrumb");
  });

  it("renders active HTML as fetched escaped-text UI, not a native embed", async () => {
    const resolution: PublicShareResolution = {
      ...lockedFileResolution,
      share: {
        ...lockedFileResolution.share,
        hasPassword: false,
      },
      access: {
        requiresPassword: false,
        isUnlocked: true,
      },
      file: {
        ...lockedFileResolution.file,
        name: "payload.html",
        mimeType: "text/html; charset=UTF-8",
        viewerKind: "text",
      },
    };

    const markup = await renderMarkup(
      shareElement({
        resolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain("Loading…");
    expect(markup).not.toMatch(/<(?:audio|embed|iframe|img|object|video)\b/u);
  });

  it("does not fetch active text source when downloads are disabled", async () => {
    const resolution: PublicShareResolution = {
      ...lockedFileResolution,
      share: {
        ...lockedFileResolution.share,
        hasPassword: false,
        downloadDisabled: true,
      },
      access: {
        requiresPassword: false,
        isUnlocked: true,
      },
      file: {
        ...lockedFileResolution.file,
        name: "payload.html",
        mimeType: "text/html",
        viewerKind: "text",
      },
    };

    const markup = await renderMarkup(
      shareElement({
        resolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).not.toContain("Loading…");
    expect(markup).not.toMatch(/<(?:audio|embed|iframe|img|object|video)\b/u);
  });

  it("does not native-embed a shared SVG classified as an image", async () => {
    const resolution: PublicShareResolution = {
      ...lockedFileResolution,
      share: {
        ...lockedFileResolution.share,
        hasPassword: false,
      },
      access: {
        requiresPassword: false,
        isUnlocked: true,
      },
      file: {
        ...lockedFileResolution.file,
        name: "payload.svg",
        mimeType: "image/svg+xml",
        viewerKind: "image",
      },
    };

    const markup = await renderMarkup(
      shareElement({
        resolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain("payload.svg");
    expect(markup).not.toMatch(/<(?:audio|embed|iframe|img|object|video)\b/u);
  });

  it("keeps an allowlisted raster image native-inline", async () => {
    const resolution: PublicShareResolution = {
      ...lockedFileResolution,
      share: {
        ...lockedFileResolution.share,
        hasPassword: false,
      },
      access: {
        requiresPassword: false,
        isUnlocked: true,
      },
      file: {
        ...lockedFileResolution.file,
        name: "safe.png",
        mimeType: "image/png",
        viewerKind: "image",
      },
    };

    const markup = await renderMarkup(
      shareElement({
        resolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain('<img alt="safe.png" src="/s/token/content"');
  });

  it.each([
    ["image/heic", "photo.heic"],
    ["image/heif", "photo.heif"],
  ])("keeps converted %s images native-inline", async (mimeType, name) => {
    const resolution: PublicShareResolution = {
      ...lockedFileResolution,
      share: {
        ...lockedFileResolution.share,
        hasPassword: false,
      },
      access: {
        requiresPassword: false,
        isUnlocked: true,
      },
      file: {
        ...lockedFileResolution.file,
        name,
        mimeType,
        viewerKind: "image",
      },
    };

    const markup = await renderMarkup(
      shareElement({
        resolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain(`<img alt="${name}" src="/s/token/content"`);
  });

  it("renders a ready safe preview for a non-allowlisted original video", async () => {
    const resolution = makeUnlockedFileResolution({
      downloadDisabled: true,
      mimeType: "video/quicktime",
      name: "source.mov",
      viewerKind: "video",
    });

    const markup = await renderMarkup(
      shareElement({
        filePreview: { safeInlineMimeType: "video/mp4" },
        resolution,
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain('<video controls="" playsInline=""');
    expect(markup).toContain('src="/s/token/content"');
    expect(markup).toContain("Downloads are off");
  });

  it("does not native-embed a non-allowlisted video without a ready preview", async () => {
    const markup = await renderMarkup(
      shareElement({
        filePreview: null,
        resolution: makeUnlockedFileResolution({
          mimeType: "video/quicktime",
          name: "source.mov",
          viewerKind: "video",
        }),
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).not.toContain("<video");
  });

  it("does not native-embed an unsafe ready preview over a safe original", async () => {
    const markup = await renderMarkup(
      shareElement({
        filePreview: { safeInlineMimeType: null },
        resolution: makeUnlockedFileResolution({
          mimeType: "video/mp4",
          name: "source.mp4",
          viewerKind: "video",
        }),
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).not.toContain("<video");
  });

  it("keeps an allowlisted original MP4 native-inline", async () => {
    const markup = await renderMarkup(
      shareElement({
        resolution: makeUnlockedFileResolution({
          mimeType: "video/mp4",
          name: "source.mp4",
          viewerKind: "video",
        }),
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).toContain('src="/s/token/content"');
    expect(markup).toContain("<video");
  });

  it.each([
    ["application/pdf", "document.pdf", "pdf", "<embed"],
    ["text/plain", "notes.txt", "text", "Loading…"],
    ["audio/mpeg", "track.mp3", "audio", "<audio"],
  ] as const)(
    "preserves native public rendering for %s",
    async (mimeType, name, viewerKind, expectedMarkup) => {
      const markup = await renderMarkup(
        shareElement({
          resolution: makeUnlockedFileResolution({
            mimeType,
            name,
            viewerKind,
          }),
          searchParams: {},
          token: "token",
        }),
      );

      expect(markup).toContain(expectedMarkup);
    },
  );

  it("keeps an unknown file out of all native viewers", async () => {
    const markup = await renderMarkup(
      shareElement({
        resolution: makeUnlockedFileResolution({
          mimeType: "application/x-unknown",
          name: "unknown.bin",
          viewerKind: null,
        }),
        searchParams: {},
        token: "token",
      }),
    );

    expect(markup).not.toMatch(/<(?:audio|embed|iframe|img|object|video)\b/u);
  });
});
