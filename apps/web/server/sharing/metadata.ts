import { formatBytes } from "@/lib/format-bytes";
import {
  findReadyDerivative,
  findReadyPosterDerivative,
} from "@staaash/db/media-derivatives";

import { authService } from "@/server/auth/service";
import type { FileSummary } from "@/server/files/types";

import { sharingService } from "./service";
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
const PLAYABLE_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const DEFAULT_VIDEO_EMBED_DIMENSIONS = {
  width: 1280,
  height: 720,
};

type VideoEmbedMetadata = {
  type: string;
  width: number;
  height: number;
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
  posterPath?: string | null;
  file: FileSummary;
  videoEmbedMetadata: VideoEmbedMetadata | null;
  posterImageMetadata?: ImageEmbedMetadata | null;
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
};

const normalizeMimeType = (mimeType: string) =>
  mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

const getOriginalVideoEmbedMetadata = (
  file: FileSummary,
): VideoEmbedMetadata | null => {
  const type = normalizeMimeType(file.mimeType);

  if (!PLAYABLE_VIDEO_TYPES.has(type)) return null;

  return {
    type,
    ...DEFAULT_VIDEO_EMBED_DIMENSIONS,
  };
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
  const posterUrl = target.posterPath
    ? toAbsoluteUrl(target.posterPath, baseUrl)
    : null;
  const isImage = file.viewerKind === "image";
  const videoEmbedMetadata =
    file.viewerKind === "video"
      ? (target.videoEmbedMetadata ?? getOriginalVideoEmbedMetadata(file))
      : null;
  const shouldExposeVideo = videoEmbedMetadata !== null;
  const imageMetadata = isImage
    ? { url: mediaUrl, alt: file.name }
    : target.posterImageMetadata && posterUrl
      ? {
          url: posterUrl,
          alt: file.name,
          ...target.posterImageMetadata,
        }
      : null;

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
                type: videoEmbedMetadata.type,
                width: videoEmbedMetadata.width,
                height: videoEmbedMetadata.height,
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

// Each check is one reason a video cannot be embedded.
// fallow-ignore-next-line complexity
const getReadyVideoEmbedMetadata = async (
  fileId: string,
): Promise<VideoEmbedMetadata | null> => {
  const derivative = await findReadyDerivative(fileId);
  const mimeType = normalizeMimeType(derivative?.mimeType ?? "");
  const width = derivative?.width ?? 0;
  const height = derivative?.height ?? 0;

  if (!derivative?.storageKey || mimeType !== "video/mp4") return null;
  if (width <= 0 || height <= 0) return null;

  return {
    type: mimeType,
    width,
    height,
  };
};

// Each check is one reason a poster cannot be shown.
// fallow-ignore-next-line complexity
const getReadyPosterImageMetadata = async (
  fileId: string,
): Promise<ImageEmbedMetadata | null> => {
  const derivative = await findReadyPosterDerivative(fileId);
  const mimeType = normalizeMimeType(derivative?.mimeType ?? "");
  const width = derivative?.width ?? 0;
  const height = derivative?.height ?? 0;

  if (!derivative?.storageKey || mimeType !== "image/jpeg") return null;
  if (width <= 0 || height <= 0) return null;

  return {
    type: mimeType,
    width,
    height,
  };
};

const shouldExposeShareDetails = (resolution: PublicShareContext) =>
  resolution.share.status === "active" && !resolution.share.hasPassword;

const buildRootSharePath = (token: string) => `/s/${encodeURIComponent(token)}`;

const buildFolderSharePath = (token: string, folderId: string) =>
  `/s/${encodeURIComponent(token)}/f/${encodeURIComponent(folderId)}`;

const buildFileSharePath = (token: string, fileId: string) =>
  `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`;

const buildNestedFileContentPath = (token: string, fileId: string) =>
  `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/content`;

const buildRootSharePosterPath = (token: string) =>
  `${buildRootSharePath(token)}/poster`;

const buildNestedFilePosterPath = (token: string, fileId: string) =>
  `/s/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}/poster`;

// One branch per share state the link card can show.
// fallow-ignore-next-line complexity
export const getSharePageMetadata = async ({
  baseUrl,
  fileId,
  folderId,
  shareAccessCookieValue,
  token,
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

      return buildShareMetadata({
        baseUrl,
        instanceName,
        target: {
          kind: "file",
          pagePath: buildFileSharePath(token, file.id),
          contentPath: buildNestedFileContentPath(token, file.id),
          posterPath:
            file.viewerKind === "video"
              ? buildNestedFilePosterPath(token, file.id)
              : null,
          file,
          videoEmbedMetadata:
            file.viewerKind === "video"
              ? await getReadyVideoEmbedMetadata(file.id)
              : null,
          posterImageMetadata:
            file.viewerKind === "video"
              ? await getReadyPosterImageMetadata(file.id)
              : null,
        },
      });
    }

    if (resolution.kind === "file") {
      return buildShareMetadata({
        baseUrl,
        instanceName,
        target: {
          kind: "file",
          pagePath: buildRootSharePath(token),
          contentPath: `${buildRootSharePath(token)}/content`,
          posterPath:
            resolution.file.viewerKind === "video"
              ? buildRootSharePosterPath(token)
              : null,
          file: resolution.file,
          videoEmbedMetadata:
            resolution.file.viewerKind === "video"
              ? await getReadyVideoEmbedMetadata(resolution.file.id)
              : null,
          posterImageMetadata:
            resolution.file.viewerKind === "video"
              ? await getReadyPosterImageMetadata(resolution.file.id)
              : null,
        },
      });
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
