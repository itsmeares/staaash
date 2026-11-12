import { formatBytes } from "@/lib/format-bytes";
import { authService } from "@/server/auth/service";
import type { FileSummary } from "@/server/files/types";

import { sharingService } from "./service";
import { getCardPicture, getCardVideo } from "./chat-media";
import type { PublicShareContext } from "./types";

const DEFAULT_INSTANCE_NAME = "Staaash";

type OpenGraphMedia = {
  url: string;
  alt?: string;
  type?: string;
  width?: number;
  height?: number;
};

/** What a link preview (chat apps, social sites) reads from a share page. */
export type Metadata = {
  title: string;
  description: string;
  robots?: { index: false; follow: false };
  openGraph: {
    title: string;
    description: string;
    siteName: string;
    type: string;
    url: string;
    images?: OpenGraphMedia[];
    videos?: OpenGraphMedia[];
  };
  twitter: {
    card: string;
    title: string;
    description: string;
    images?: string[];
  };
};

const escapeHtml = (value: string | number) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

/** The <head> tags for a share page. */
export const toMetaTags = ({
  title,
  description,
  robots,
  openGraph,
  twitter,
}: Metadata) => {
  const tag = (
    attribute: "name" | "property",
    key: string,
    value: string | number,
  ) => `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`;
  const media = (kind: "image" | "video", items: OpenGraphMedia[] = []) =>
    items.flatMap(({ url, alt, type, width, height }) => [
      tag("property", `og:${kind}`, url),
      ...(alt ? [tag("property", `og:${kind}:alt`, alt)] : []),
      ...(type ? [tag("property", `og:${kind}:type`, type)] : []),
      ...(width ? [tag("property", `og:${kind}:width`, width)] : []),
      ...(height ? [tag("property", `og:${kind}:height`, height)] : []),
    ]);
  return [
    `<title>${escapeHtml(title)}</title>`,
    tag("name", "description", description),
    ...(robots ? [tag("name", "robots", "noindex, nofollow")] : []),
    tag("property", "og:title", openGraph.title),
    tag("property", "og:description", openGraph.description),
    tag("property", "og:site_name", openGraph.siteName),
    tag("property", "og:type", openGraph.type),
    tag("property", "og:url", openGraph.url),
    ...media("image", openGraph.images),
    ...media("video", openGraph.videos),
    tag("name", "twitter:card", twitter.card),
    tag("name", "twitter:title", twitter.title),
    tag("name", "twitter:description", twitter.description),
    ...(twitter.images ?? []).map((url) => tag("name", "twitter:image", url)),
  ].join("\n    ");
};
type VideoEmbedMetadata = {
  type: string;
  width?: number;
  height?: number;
};

type ImageEmbedMetadata = {
  type?: string;
  width?: number;
  height?: number;
};

type GenericShareMetadataTarget = {
  kind: "generic";
  pagePath: string;
  noindex: boolean;
};

type FileShareMetadataTarget = {
  kind: "file";
  pagePath: string;
  contentPath: string;
  imagePath?: string | null;
  file: FileSummary;
  videoEmbedMetadata: VideoEmbedMetadata | null;
  imageMetadata?: ImageEmbedMetadata | null;
};

type FolderShareMetadataTarget = {
  kind: "folder";
  pagePath: string;
  folderName: string;
};

export type ShareMetadataTarget =
  | GenericShareMetadataTarget
  | FileShareMetadataTarget
  | FolderShareMetadataTarget;

export type ShareMetadataInput = {
  baseUrl: string;
  instanceName?: string | null;
  target: ShareMetadataTarget;
};

type SharePageMetadataInput = {
  baseUrl: string;
  fileId?: string;
  folderId?: string;
  shareAccessCookieValue?: string | null;
  token: string;
  signal?: AbortSignal;
};

const toAbsoluteUrl = (path: string, baseUrl: string) =>
  new URL(path, baseUrl).toString();

const buildGenericDescription = (instanceName: string) =>
  `A file or folder shared via ${instanceName}.`;

const buildGenericShareMetadata = ({
  baseUrl,
  instanceName,
  pagePath,
  noindex,
}: {
  baseUrl: string;
  instanceName: string;
  pagePath: string;
  noindex: boolean;
}): Metadata => {
  const title = `${instanceName} share`;
  const description = buildGenericDescription(instanceName);
  const pageUrl = toAbsoluteUrl(pagePath, baseUrl);

  return {
    title,
    description,
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
      title,
      description,
      siteName: instanceName,
      type: "website",
      url: pageUrl,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
};

// Exported for its unit tests.
// fallow-ignore-next-line unused-export complexity
export const buildShareMetadata = ({
  baseUrl,
  instanceName: rawInstanceName,
  target,
}: ShareMetadataInput): Metadata => {
  const instanceName = rawInstanceName?.trim() || DEFAULT_INSTANCE_NAME;

  if (target.kind === "generic") {
    return buildGenericShareMetadata({
      baseUrl,
      instanceName,
      pagePath: target.pagePath,
      noindex: target.noindex,
    });
  }

  const pageUrl = toAbsoluteUrl(target.pagePath, baseUrl);

  if (target.kind === "folder") {
    const title = `${target.folderName} - ${instanceName}`;
    const description = `Folder shared via ${instanceName}.`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        siteName: instanceName,
        type: "website",
        url: pageUrl,
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  }

  const file = target.file;
  const title = `${file.name} - ${instanceName}`;
  const description = `${file.mimeType} - ${formatBytes(file.sizeBytes)} shared via ${instanceName}.`;
  const mediaUrl = toAbsoluteUrl(target.contentPath, baseUrl);
  const posterUrl = target.imagePath
    ? toAbsoluteUrl(target.imagePath, baseUrl)
    : null;
  const videoEmbedMetadata = target.videoEmbedMetadata;
  const imageMetadata =
    target.imageMetadata && posterUrl
      ? { url: posterUrl, alt: file.name, ...target.imageMetadata }
      : null;
  const shouldExposeVideo =
    videoEmbedMetadata !== null && imageMetadata !== null;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: instanceName,
      type: shouldExposeVideo ? "video.other" : "website",
      url: pageUrl,
      ...(imageMetadata
        ? {
            images: [imageMetadata],
          }
        : {}),
      ...(shouldExposeVideo
        ? {
            videos: [
              {
                url: mediaUrl,
                ...videoEmbedMetadata,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: imageMetadata ? "summary_large_image" : "summary",
      title,
      description,
      ...(imageMetadata ? { images: [imageMetadata.url] } : {}),
    },
  };
};

const getInstanceName = async (): Promise<string> => {
  try {
    const setupState = await authService.getSetupState();
    return setupState.instanceName?.trim() || DEFAULT_INSTANCE_NAME;
  } catch {
    return DEFAULT_INSTANCE_NAME;
  }
};

const shouldExposeShareDetails = (resolution: PublicShareContext) =>
  resolution.share.status === "active" && !resolution.share.hasPassword;

const buildRootSharePath = (token: string) => `/s/${encodeURIComponent(token)}`;

const buildFolderSharePath = (token: string, folderId: string) =>
  `/s/${encodeURIComponent(token)}/f/${encodeURIComponent(folderId)}`;

const buildFileSharePath = (token: string, fileId: string) =>
  `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`;

const buildFileMetadata = async (
  file: FileSummary,
  pagePath: string,
  baseUrl: string,
  instanceName: string,
  signal?: AbortSignal,
) => {
  const [picture, video] = await Promise.all([
    getCardPicture(file, signal),
    getCardVideo(file),
  ]);
  return buildShareMetadata({
    baseUrl,
    instanceName,
    target: {
      kind: "file",
      pagePath,
      contentPath: `${pagePath}/content`,
      imagePath: `${pagePath}/thumbnail`,
      file,
      videoEmbedMetadata: video,
      imageMetadata: picture,
    },
  });
};

// One branch per share state the link card can show.
// fallow-ignore-next-line complexity
export const getSharePageMetadata = async ({
  baseUrl,
  fileId,
  folderId,
  shareAccessCookieValue,
  token,
  signal,
}: SharePageMetadataInput): Promise<Metadata> => {
  const instanceName = await getInstanceName();
  const fallbackPath = fileId
    ? buildFileSharePath(token, fileId)
    : folderId
      ? buildFolderSharePath(token, folderId)
      : buildRootSharePath(token);

  const fallbackMetadata = () =>
    buildShareMetadata({
      baseUrl,
      instanceName,
      target: {
        kind: "generic",
        pagePath: fallbackPath,
        noindex: true,
      },
    });

  // The card can wait seconds for its picture; a password or revocation
  // added meanwhile must still hide the file's name and size.
  const stillShared = async (metadata: Metadata) =>
    shouldExposeShareDetails(
      await sharingService.resolvePublicShareContext({
        token,
        shareAccessCookieValue,
        baseUrl,
      }),
    )
      ? metadata
      : fallbackMetadata();

  try {
    const resolution = await sharingService.resolvePublicShareContext({
      token,
      requestedFolderId: folderId,
      shareAccessCookieValue,
      baseUrl,
    });

    if (!shouldExposeShareDetails(resolution)) {
      return fallbackMetadata();
    }

    if (fileId) {
      if (resolution.kind !== "folder") {
        return fallbackMetadata();
      }

      const { file } = await sharingService.getSharedNestedFileContent({
        token,
        fileId,
        shareAccessCookieValue,
      });

      const metadata = await buildFileMetadata(
        file,
        buildFileSharePath(token, file.id),
        baseUrl,
        instanceName,
        signal,
      );
      // Throws if the file left the shared folder during the wait.
      await sharingService.getSharedNestedFileContent({
        token,
        fileId,
        shareAccessCookieValue,
      });
      return await stillShared(metadata);
    }

    if (resolution.kind === "file") {
      return await stillShared(
        await buildFileMetadata(
          resolution.file,
          buildRootSharePath(token),
          baseUrl,
          instanceName,
          signal,
        ),
      );
    }

    return buildShareMetadata({
      baseUrl,
      instanceName,
      target: {
        kind: "folder",
        pagePath: folderId
          ? buildFolderSharePath(token, resolution.listing.currentFolder.id)
          : buildRootSharePath(token),
        folderName: resolution.listing.currentFolder.name,
      },
    });
  } catch {
    return fallbackMetadata();
  }
};
