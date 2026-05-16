import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, Share2, Video } from "lucide-react";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import type { FolderSummary } from "@/server/files/types";
import { ItemContextMenu } from "@/app/item-context-menu";
import { ItemTypeIcon, itemVisualIconMap } from "@/app/item-type-icon";
import { retrievalService } from "@/server/retrieval/service";
import type { RetrievalItem } from "@/server/retrieval/types";
import { getBaseUrl } from "@/server/request";
import { sharingService } from "@/server/sharing/service";
import type { ShareLinkSummary } from "@/server/sharing/types";
import type { UserRole } from "@/server/types";

import {
  formatHomeChildCount,
  formatHomeExpiryTime,
  formatHomeRelativeTime,
  getHomeGreeting,
  getHomeItemVisual,
  type HomeItemVisual,
} from "./home-helpers";

export const dynamic = "force-dynamic";

type HomeFolder = {
  folder: FolderSummary;
  childCount: number;
};

function SectionHeader({
  actionHref,
  actionLabel,
  title,
  titleId,
}: {
  actionHref?: string;
  actionLabel?: string;
  title: string;
  titleId: string;
}) {
  return (
    <div className="home-section-head">
      <h2 className="home-section-title" id={titleId}>
        {title}
      </h2>
      {actionHref && actionLabel ? (
        <Link className="home-section-link" href={actionHref}>
          <span>{actionLabel}</span>
          <ArrowRight size={12} strokeWidth={1.8} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function HomeIcon({ visual }: { visual: HomeItemVisual }) {
  return <ItemTypeIcon className="home-item-icon" visual={visual} />;
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="home-empty-line">{children}</p>;
}

function PinnedList({
  items,
  redirectTo,
}: {
  items: RetrievalItem[];
  redirectTo: string;
}) {
  if (items.length === 0) {
    return <EmptyLine>No pinned files yet</EmptyLine>;
  }

  return (
    <div className="home-pinned-list">
      {items.map((item) => {
        const visual = getHomeItemVisual(
          item.kind,
          item.kind === "file" ? item.mimeType : null,
        );
        const content = (
          <>
            <HomeIcon visual={visual} />
            <span className="home-pinned-name">{item.name}</span>
          </>
        );

        return (
          <ItemContextMenu
            href={item.href}
            id={item.id}
            isFavorite={item.isFavorite}
            key={`${item.kind}-${item.id}`}
            kind={item.kind}
            name={item.name}
            redirectTo={redirectTo}
          >
            {item.kind === "folder" ? (
              <Link className="home-pinned-row" href={item.href}>
                {content}
              </Link>
            ) : (
              <a className="home-pinned-row" href={item.href}>
                {content}
              </a>
            )}
          </ItemContextMenu>
        );
      })}
    </div>
  );
}

function PreviewLines() {
  return (
    <span className="home-doc-preview-lines" aria-hidden>
      {[82, 65, 90, 50, 76, 60].map((width, index) => (
        <span
          key={`${width}-${index}`}
          style={{
            width: `${width}%`,
          }}
        />
      ))}
    </span>
  );
}

function AudioBars({ color }: { color: string }) {
  const bars = [5, 9, 14, 10, 18, 22, 16, 12, 20, 24, 18, 14, 10, 16, 20, 14];

  return (
    <span className="home-audio-bars" aria-hidden>
      {bars.map((height, index) => (
        <span
          key={`${height}-${index}`}
          style={{
            background: color,
            height: `${height}px`,
          }}
        />
      ))}
    </span>
  );
}

function RecentPreview({ item }: { item: RetrievalItem }) {
  const visual = getHomeItemVisual(
    item.kind,
    item.kind === "file" ? item.mimeType : null,
  );
  const Icon = itemVisualIconMap[visual.kind];

  if (visual.kind === "video") {
    return (
      <span className="home-recent-preview home-recent-preview-video">
        <span className="home-video-strips" aria-hidden />
        <span className="home-video-play" aria-hidden>
          <Video size={14} strokeWidth={1.8} />
        </span>
      </span>
    );
  }

  if (visual.kind === "audio") {
    return (
      <span
        className="home-recent-preview"
        style={{ background: visual.background }}
      >
        <AudioBars color={visual.color} />
      </span>
    );
  }

  if (visual.kind === "pdf" || visual.kind === "text") {
    return (
      <span
        className="home-recent-preview home-recent-preview-document"
        style={{ background: visual.background }}
      >
        <PreviewLines />
        <span className="home-preview-type" style={{ color: visual.color }}>
          {visual.kind === "pdf" ? "PDF" : "TXT"}
        </span>
      </span>
    );
  }

  return (
    <span
      className="home-recent-preview"
      style={{ background: visual.background }}
    >
      <Icon size={24} strokeWidth={1.7} color={visual.color} aria-hidden />
    </span>
  );
}

function RecentGrid({
  items,
  redirectTo,
}: {
  items: RetrievalItem[];
  redirectTo: string;
}) {
  if (items.length === 0) {
    return <EmptyLine>Nothing recent yet</EmptyLine>;
  }

  return (
    <div className="home-recent-grid">
      {items.map((item) => {
        const content = (
          <>
            <RecentPreview item={item} />
            <span className="home-recent-body">
              <span className="home-recent-name" title={item.name}>
                {item.name}
              </span>
              <span className="home-recent-meta">
                {formatHomeRelativeTime(item.updatedAt)}
              </span>
            </span>
          </>
        );

        return (
          <ItemContextMenu
            href={item.href}
            id={item.id}
            isFavorite={item.isFavorite}
            key={`${item.kind}-${item.id}`}
            kind={item.kind}
            name={item.name}
            redirectTo={redirectTo}
          >
            {item.kind === "folder" ? (
              <Link className="home-recent-card" href={item.href}>
                {content}
              </Link>
            ) : (
              <a className="home-recent-card" href={item.href}>
                {content}
              </a>
            )}
          </ItemContextMenu>
        );
      })}
    </div>
  );
}

function FolderList({
  folders,
  redirectTo,
}: {
  folders: HomeFolder[];
  redirectTo: string;
}) {
  if (folders.length === 0) {
    return <EmptyLine>No folders yet</EmptyLine>;
  }

  return (
    <div className="home-folder-list">
      {folders.map(({ folder, childCount }) => {
        const href = folder.isFilesRoot ? "/files" : `/files/f/${folder.id}`;

        return (
          <ItemContextMenu
            href={href}
            id={folder.id}
            key={folder.id}
            kind="folder"
            name={folder.name}
            redirectTo={redirectTo}
          >
            <Link className="home-folder-row" href={href}>
              <HomeIcon visual={getHomeItemVisual("folder")} />
              <span className="home-folder-name">{folder.name}</span>
              <span className="home-folder-meta">
                {formatHomeChildCount(childCount)}
              </span>
            </Link>
          </ItemContextMenu>
        );
      })}
    </div>
  );
}

function SharedList({ shares }: { shares: ShareLinkSummary[] }) {
  if (shares.length === 0) {
    return <EmptyLine>No active links</EmptyLine>;
  }

  return (
    <div className="home-shared-list">
      {shares.map((share) => {
        const visual = getHomeItemVisual(
          share.target.targetType,
          share.target.targetType === "file" ? share.target.mimeType : null,
        );

        return (
          <ItemContextMenu
            href={`/shared#${share.id}`}
            id={share.id}
            key={share.id}
            kind="share"
            name={share.target.name}
          >
            <Link className="home-shared-row" href={`/shared#${share.id}`}>
              <HomeIcon visual={visual} />
              <span className="home-shared-main">
                <span className="home-shared-name">{share.target.name}</span>
                <span className="home-shared-meta">
                  {share.downloadDisabled ? "Downloads off" : "Downloads on"}
                  {" · expires "}
                  {formatHomeExpiryTime(share.expiresAt)}
                </span>
              </span>
              <Share2 size={13} strokeWidth={1.8} aria-hidden />
            </Link>
          </ItemContextMenu>
        );
      })}
    </div>
  );
}

async function getHomeFolders({
  actorRole,
  actorUserId,
}: {
  actorRole: UserRole;
  actorUserId: string;
}): Promise<HomeFolder[]> {
  const listing = await filesService.getFilesListing({
    actorRole,
    actorUserId,
  });

  return Promise.all(
    listing.childFolders.slice(0, 4).map(async (folder) => {
      const childListing = await filesService.getFilesListing({
        actorRole,
        actorUserId,
        folderId: folder.id,
      });

      return {
        folder,
        childCount:
          childListing.childFolders.length + childListing.files.length,
      };
    }),
  );
}

export default async function HomePage() {
  const [session, h] = await Promise.all([
    requireSignedInPageSession("/?next=/home"),
    headers(),
  ]);

  const actor = {
    actorUserId: session.user.id,
    actorRole: session.user.role,
  };
  const baseUrl = getBaseUrl(h);
  const [favoriteItems, recentItems, folders, shares] = await Promise.all([
    retrievalService.listFavorites(actor),
    retrievalService.listRecent(actor),
    getHomeFolders(actor),
    sharingService.listOwnedShares({
      ...actor,
      baseUrl,
    }),
  ]);
  const displayName = session.user.displayName ?? session.user.username;
  const greeting = getHomeGreeting(new Date().getHours());
  const currentPath = "/home";

  return (
    <div className="workspace-page home-page">
      <header className="home-greeting">
        <h1>{`${greeting}, ${displayName}.`}</h1>
      </header>

      <div className="home-top-grid">
        <section className="home-section" aria-labelledby="home-pinned-title">
          <SectionHeader title="Pinned" titleId="home-pinned-title" />
          <PinnedList
            items={favoriteItems.slice(0, 6)}
            redirectTo={currentPath}
          />
        </section>

        <section className="home-section" aria-labelledby="home-recent-title">
          <SectionHeader
            actionHref="/files"
            actionLabel="All files"
            title="Recent"
            titleId="home-recent-title"
          />
          <RecentGrid
            items={recentItems.slice(0, 6)}
            redirectTo={currentPath}
          />
        </section>
      </div>

      <div className="home-bottom-grid">
        <section className="home-section" aria-labelledby="home-folders-title">
          <SectionHeader
            actionHref="/files"
            actionLabel="View all"
            title="Folders"
            titleId="home-folders-title"
          />
          <FolderList folders={folders} redirectTo={currentPath} />
        </section>

        <section className="home-section" aria-labelledby="home-shared-title">
          <SectionHeader
            actionHref="/shared"
            actionLabel="Manage"
            title="Shared links"
            titleId="home-shared-title"
          />
          <SharedList shares={shares.active.slice(0, 3)} />
        </section>
      </div>
    </div>
  );
}
