import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowRight,
  Clock,
  FolderPlus,
  Heart,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { requireSignedInPageSession } from "@/server/auth/guards";
import { filesService } from "@/server/files/service";
import type { FolderSummary } from "@/server/files/types";
import { ItemContextMenu } from "@/app/item-context-menu";
import { WorkspacePresetPageContextMenu } from "@/app/dashboard-context-menu";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { retrievalService } from "@/server/retrieval/service";
import type { RetrievalItem } from "@/server/retrieval/types";
import { getShareBaseUrl } from "@/server/request";
import { sharingService } from "@/server/sharing/service";
import type { ShareLinkSummary } from "@/server/sharing/types";
import type { UserRole } from "@/server/types";

import {
  formatHomeChildCount,
  formatHomeExpiryTime,
  formatHomeRelativeTime,
  getHomeGreeting,
  getHomeItemVisual,
  isHomeDashboardEmpty,
  type HomeItemVisual,
} from "./home-helpers";
import { HomePrimaryActions } from "./home-actions";

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
  return <ItemTypeIcon className="home-item-icon" size={16} visual={visual} />;
}

function HomeEmptyBlock({
  icon: Icon,
  title,
}: {
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="home-empty-block">
      <span className="home-empty-icon" aria-hidden>
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <span className="home-empty-copy">
        <strong>{title}</strong>
      </span>
    </div>
  );
}

function HomeFirstRunState() {
  return (
    <section className="home-first-run" aria-label="Start your drive">
      <span className="home-first-run-icon" aria-hidden>
        <FolderPlus size={24} strokeWidth={1.7} />
      </span>
      <div className="home-first-run-copy">
        <h2>Add your first file</h2>
        <p>Upload something now, or create a folder first.</p>
      </div>
      <HomePrimaryActions />
    </section>
  );
}

function PinnedList({
  items,
  redirectTo,
}: {
  items: RetrievalItem[];
  redirectTo: string;
}) {
  if (items.length === 0) {
    return <HomeEmptyBlock icon={Heart} title="Nothing pinned" />;
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

function RecentList({
  items,
  redirectTo,
}: {
  items: RetrievalItem[];
  redirectTo: string;
}) {
  if (items.length === 0) {
    return <HomeEmptyBlock icon={Clock} title="Nothing recent" />;
  }

  return (
    <div className="home-recent-list">
      {items.map((item) => {
        const visual = getHomeItemVisual(
          item.kind,
          item.kind === "file" ? item.mimeType : null,
        );
        const content = (
          <>
            <HomeIcon visual={visual} />
            <span className="home-recent-main">
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
              <Link className="home-recent-row" href={item.href}>
                {content}
              </Link>
            ) : (
              <a className="home-recent-row" href={item.href}>
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
    return <HomeEmptyBlock icon={FolderPlus} title="No folders" />;
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
    return <HomeEmptyBlock icon={Share2} title="No links" />;
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
  const baseUrl = getShareBaseUrl(h);
  const [favoriteItems, recentItems, folders, shares] = await Promise.all([
    retrievalService.listFavorites(actor),
    retrievalService.listRecent(actor),
    getHomeFolders(actor),
    sharingService.listOwnedShares({
      ...actor,
      baseUrl,
    }),
  ]);
  const displayName =
    session.user.displayName ?? session.user.email.split("@")[0] ?? "there";
  const greeting = getHomeGreeting(new Date().getHours());
  const currentPath = "/home";
  const pinnedItems = favoriteItems.slice(0, 6);
  const recentHomeItems = recentItems.slice(0, 6);
  const activeShares = shares.active.slice(0, 3);
  const dashboardEmpty = isHomeDashboardEmpty({
    favoriteCount: favoriteItems.length,
    recentCount: recentItems.length,
    folderCount: folders.length,
    shareCount: shares.active.length,
  });

  return (
    <WorkspacePresetPageContextMenu
      className={`workspace-page home-page${dashboardEmpty ? " home-page-empty" : ""}`}
      preset="home"
    >
      <header className="home-hero">
        <div className="home-greeting">
          <h1>{`${greeting}, ${displayName}.`}</h1>
        </div>
        {dashboardEmpty ? null : <HomePrimaryActions />}
      </header>

      {dashboardEmpty ? (
        <HomeFirstRunState />
      ) : (
        <div className="home-sections-grid">
          <section className="home-section" aria-labelledby="home-pinned-title">
            <SectionHeader title="Pinned" titleId="home-pinned-title" />
            <PinnedList items={pinnedItems} redirectTo={currentPath} />
          </section>

          <section className="home-section" aria-labelledby="home-recent-title">
            <SectionHeader
              actionHref="/files"
              actionLabel="All files"
              title="Recent"
              titleId="home-recent-title"
            />
            <RecentList items={recentHomeItems} redirectTo={currentPath} />
          </section>

          <section
            className="home-section"
            aria-labelledby="home-folders-title"
          >
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
            <SharedList shares={activeShares} />
          </section>
        </div>
      )}
    </WorkspacePresetPageContextMenu>
  );
}
