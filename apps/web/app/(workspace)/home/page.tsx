import Link from "next/link";
import { headers } from "next/headers";
import {
  ArrowRight,
  Clock,
  FolderPlus,
  Heart,
  Link2 as LinkIcon,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { formatRelativeTime } from "@/lib/time";
import { requireSignedInPageSession } from "@/server/auth/guards";
import { resolveDisplayTimeZone } from "@/server/time-zone";
import { filesService } from "@/server/files/service";
import type { FolderSummary } from "@/server/files/types";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
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
  getHomeItemVisual,
  isHomeDashboardEmpty,
  type HomeItemVisual,
} from "./home-helpers";
import { HomeGreeting, HomePrimaryActions } from "./home-actions";

export const dynamic = "force-dynamic";

type HomeFolder = {
  folder: FolderSummary;
  childCount: number;
};

const HOME_LIST = "grid min-h-12 [&>[data-slot=context-menu]]:contents";
const HOME_ROW =
  "grid min-h-12 grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-1.75 py-1.25 text-foreground transition-colors duration-100 hover:bg-hover motion-reduce:transition-none lg:h-row-home lg:gap-x-3 lg:px-2.25 lg:py-2";
const HOME_NAME =
  "block min-w-0 truncate text-sm leading-tight font-medium lg:text-body";
const HOME_META = "text-xs leading-tight text-muted-foreground lg:text-meta";

const EMPTY_TONE_CLASS = {
  favorite: "text-destructive",
  folder: "text-primary-ink",
  neutral: "text-muted-foreground",
  recent: "text-info",
  share: "text-success",
} as const;

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
    <div className="mb-2 flex min-h-4.5 items-center justify-between gap-3 border-b border-hairline pb-2 lg:mb-2.5 lg:min-h-6 lg:pb-2.5">
      <h2
        className="flex min-h-4.5 items-center text-label font-medium text-muted-foreground lg:min-h-6 lg:text-body"
        id={titleId}
      >
        {title}
      </h2>
      {actionHref && actionLabel ? (
        <Link
          className="inline-flex min-h-4.5 items-center gap-1 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground motion-reduce:transition-none lg:min-h-6 lg:text-meta"
          href={actionHref}
        >
          <span>{actionLabel}</span>
          <ArrowRight size={12} strokeWidth={1.8} aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function HomeIcon({ visual }: { visual: HomeItemVisual }) {
  return (
    <ItemTypeIcon
      className="inline-flex size-6 shrink-0 items-center justify-center justify-self-center lg:size-7.5 [&_svg]:size-4 lg:[&_svg]:size-5"
      size={16}
      tone="plain"
      visual={visual}
    />
  );
}

function HomeEmptyBlock({
  icon: Icon,
  tone = "neutral",
  title,
}: {
  icon: LucideIcon;
  tone?: keyof typeof EMPTY_TONE_CLASS;
  title: string;
}) {
  return (
    <div className={cn(HOME_ROW, "hover:bg-transparent")}>
      <span
        className={cn(
          "inline-flex size-6 items-center justify-center justify-self-center lg:size-7.5 [&_svg]:size-4 lg:[&_svg]:size-5",
          EMPTY_TONE_CLASS[tone],
        )}
        aria-hidden
      >
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <span className="min-w-0 text-label text-muted-foreground lg:text-meta">
        {title}
      </span>
    </div>
  );
}

function HomeFirstRunState() {
  return (
    <section aria-label="Start your drive">
      <Empty className="min-h-[min(52vh,520px)]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderPlus aria-hidden />
          </EmptyMedia>
          <EmptyTitle>Add your first file</EmptyTitle>
          <EmptyDescription>
            Upload something now, or create a folder first.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <HomePrimaryActions className="justify-center" />
        </EmptyContent>
      </Empty>
    </section>
  );
}

function getRetrievalItemVisual(item: RetrievalItem) {
  return getHomeItemVisual(
    item.kind,
    item.kind === "file" ? item.mimeType : null,
  );
}

function HomeItemRow({
  item,
  redirectTo,
  children,
}: {
  item: RetrievalItem;
  redirectTo: string;
  children: React.ReactNode;
}) {
  return (
    <ItemContextMenu
      href={item.href}
      id={item.id}
      isFavorite={item.isFavorite}
      kind={item.kind}
      name={item.name}
      redirectTo={redirectTo}
    >
      {item.kind === "folder" ? (
        <Link className={HOME_ROW} href={item.href}>
          {children}
        </Link>
      ) : (
        <a className={HOME_ROW} href={item.href}>
          {children}
        </a>
      )}
    </ItemContextMenu>
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
    return (
      <HomeEmptyBlock icon={Heart} title="Nothing pinned yet" tone="favorite" />
    );
  }

  return (
    <div className={HOME_LIST}>
      {items.map((item) => {
        const visual = getRetrievalItemVisual(item);
        const content = (
          <>
            <HomeIcon visual={visual} />
            <span className={HOME_NAME}>{item.name}</span>
          </>
        );

        return (
          <HomeItemRow
            item={item}
            key={`${item.kind}-${item.id}`}
            redirectTo={redirectTo}
          >
            {content}
          </HomeItemRow>
        );
      })}
    </div>
  );
}

function RecentList({
  items,
  now,
  redirectTo,
  timeZone,
}: {
  items: RetrievalItem[];
  now: Date;
  redirectTo: string;
  timeZone: string;
}) {
  if (items.length === 0) {
    return (
      <HomeEmptyBlock icon={Clock} title="Nothing recent yet" tone="recent" />
    );
  }

  return (
    <div className={HOME_LIST}>
      {items.map((item) => {
        const visual = getRetrievalItemVisual(item);
        const content = (
          <>
            <HomeIcon visual={visual} />
            <span className="grid min-w-0 gap-px">
              <span className={HOME_NAME} title={item.name}>
                {item.name}
              </span>
              <span className={HOME_META}>
                {formatRelativeTime(item.updatedAt, now, timeZone, "long")}
              </span>
            </span>
          </>
        );

        return (
          <HomeItemRow
            item={item}
            key={`${item.kind}-${item.id}`}
            redirectTo={redirectTo}
          >
            {content}
          </HomeItemRow>
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
    return (
      <HomeEmptyBlock icon={FolderPlus} title="No folders yet" tone="folder" />
    );
  }

  return (
    <div className={HOME_LIST}>
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
            <Link className={HOME_ROW} href={href}>
              <HomeIcon visual={getHomeItemVisual("folder")} />
              <span className={HOME_NAME}>{folder.name}</span>
              <span className="px-1 text-right text-label whitespace-nowrap text-muted-foreground lg:text-meta">
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
    return (
      <HomeEmptyBlock icon={LinkIcon} title="No shared links" tone="share" />
    );
  }

  return (
    <div className={HOME_LIST}>
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
            <Link className={HOME_ROW} href={`/shared#${share.id}`}>
              <HomeIcon visual={visual} />
              <span className="grid min-w-0 gap-px">
                <span className={HOME_NAME}>{share.target.name}</span>
                <span className={cn(HOME_META, "truncate")}>
                  {share.downloadDisabled ? "Downloads off" : "Downloads on"}
                  {", expires "}
                  {formatHomeExpiryTime(share.expiresAt)}
                </span>
              </span>
              <Share2
                className="text-muted-foreground"
                size={13}
                strokeWidth={1.8}
                aria-hidden
              />
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
  const { timeZone } = await resolveDisplayTimeZone(session.user);
  const now = new Date();
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
      className={cn(
        "grid w-full content-start gap-6 max-lg:min-w-0 lg:gap-7.5",
        dashboardEmpty && "gap-7.5 lg:gap-9.5",
      )}
      preset="home"
    >
      <header
        className={cn(
          "grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4.5 pb-1 max-lg:grid-cols-1 max-lg:items-start lg:gap-6 lg:pb-2",
          dashboardEmpty && "pb-0 lg:pb-0",
        )}
      >
        <div className="grid min-w-0 gap-2">
          <h1 className="font-heading text-3xl leading-none font-bold tracking-tight text-balance text-foreground lg:text-greeting">
            <HomeGreeting displayName={displayName} />
          </h1>
        </div>
        {dashboardEmpty ? null : <HomePrimaryActions />}
      </header>

      {dashboardEmpty ? (
        <HomeFirstRunState />
      ) : (
        <div className="grid grid-cols-2 items-start gap-7 max-lg:grid-cols-1 lg:gap-8.5">
          <section className="min-w-0" aria-labelledby="home-pinned-title">
            <SectionHeader title="Pinned" titleId="home-pinned-title" />
            <PinnedList items={pinnedItems} redirectTo={currentPath} />
          </section>

          <section className="min-w-0" aria-labelledby="home-recent-title">
            <SectionHeader
              actionHref="/files"
              actionLabel="All files"
              title="Recent"
              titleId="home-recent-title"
            />
            <RecentList
              items={recentHomeItems}
              now={now}
              redirectTo={currentPath}
              timeZone={timeZone}
            />
          </section>

          <section className="min-w-0" aria-labelledby="home-folders-title">
            <SectionHeader
              actionHref="/files"
              actionLabel="View all"
              title="Folders"
              titleId="home-folders-title"
            />
            <FolderList folders={folders} redirectTo={currentPath} />
          </section>

          <section className="min-w-0" aria-labelledby="home-shared-title">
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
