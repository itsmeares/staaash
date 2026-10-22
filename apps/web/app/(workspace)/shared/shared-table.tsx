"use client";

import { useContinuousList } from "@/components/file-list/use-continuous-list";
import { useListFind } from "@/components/file-list/use-list-find";
import type { ListPage } from "@/server/list-window";
import {
  ListLoadingRow,
  type ListLoading,
} from "@/components/file-list/list-loading";
import { loadShares, selectShares } from "../list-actions";
import {
  ChevronRight,
  ClipboardCopy,
  Eye,
  Link2,
  Lock,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ShareDialog } from "@/app/(workspace)/files/share-dialog";
import type { DashboardContextMenuGroup } from "@/app/dashboard-context-menu";
import { confirmAction } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { useTime } from "@/components/time-provider";
import { Button } from "@staaash/ui/components/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@staaash/ui/components/collapsible";
import { Empty, EmptyHeader, EmptyTitle } from "@staaash/ui/components/empty";
import { toast } from "@staaash/ui/components/toast";
import {
  FileList,
  thumbnailUrlFor,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { formatDayMonth, formatTimeUntil } from "@/lib/time";
import { copyText } from "@/lib/clipboard";
import { cn } from "@staaash/ui/utils";
import type { ShareLinkSummary } from "@/server/sharing";

import { useCoarsePointer } from "../use-coarse-pointer";
import {
  getWorkspaceLocationLabel,
  type WorkspaceItemFilterType,
} from "../workspace-item-helpers";
import { TypeAndView } from "../workspace-list-parts";

type LinkItem = FileListItem & { data: ShareLinkSummary };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const copyLink = (share: ShareLinkSummary) => {
  copyText(share.shareUrl).then(
    () => toast.success("Link copied."),
    () => toast.error("The link could not be copied."),
  );
};

const deleteLink = async (share: ShareLinkSummary) => {
  const response = await fetch(`/api/shares/${share.id}/delete`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ redirectTo: "/shared" }),
  });
  if (!response.ok) throw new Error("The link could not be deleted.");
};

const folderOf = (share: ShareLinkSummary) => {
  return getWorkspaceLocationLabel(share.target);
};

const soon = (share: ShareLinkSummary, now: Date) =>
  new Date(share.expiresAt).getTime() - now.getTime() < WEEK_MS;

/** "Turned off 11 Oct", "Expired 2 Oct". */
const stoppedLabel = (share: ShareLinkSummary, timeZone: string) => {
  if (share.status === "revoked" && share.revokedAt) {
    return `Turned off ${formatDayMonth(share.revokedAt, timeZone)}`;
  }
  if (share.status === "expired") {
    return `Expired ${formatDayMonth(share.expiresAt, timeZone)}`;
  }
  return "Unavailable";
};

/** The phone's line under the name: "Expires in 4 weeks · password". */
const linkNote = (share: ShareLinkSummary, now: Date, timeZone: string) =>
  share.status === "active"
    ? [
        `Expires in ${formatTimeUntil(share.expiresAt, now)}`,
        share.hasPassword ? "password" : null,
        share.downloadDisabled ? "view only" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : stoppedLabel(share, timeZone);

const toLinkItem = (
  share: ShareLinkSummary,
  now: Date,
  timeZone: string,
): LinkItem => {
  const target = share.target;
  const isFile = target.targetType === "file";
  const isLive = share.status === "active";
  return {
    id: share.id,
    kind: target.targetType,
    name: target.name,
    mimeType: isFile ? target.mimeType : null,
    thumbnailUrl:
      isFile && !target.deletedAt
        ? thumbnailUrlFor({ ...target, kind: "file" })
        : null,
    dimmed: !isLive,
    // Phones say when it expires under the name; wide lists have a column
    // for that and show the folder instead.
    sub: (
      <>
        <span
          className={cn(
            "@xl/list:hidden",
            isLive && soon(share, now) && "text-warning-foreground",
          )}
        >
          {linkNote(share, now, timeZone)}
        </span>
        <span className="hidden @xl/list:inline">{folderOf(share)}</span>
      </>
    ),
    data: share,
  };
};

/** Copy link on live rows, Delete on turned off ones. */
function LinkQuickAction({
  share,
  onDelete,
}: {
  share: ShareLinkSummary;
  onDelete: () => void;
}) {
  const live = share.status === "active";
  return (
    <Button
      size="sm"
      variant={live ? "outline" : "ghost"}
      onClick={(event) => {
        event.stopPropagation();
        if (live) copyLink(share);
        else onDelete();
      }}
    >
      {live ? <ClipboardCopy aria-hidden /> : null}
      {live ? "Copy link" : "Delete"}
    </Button>
  );
}

/** Manage or share again, then Copy link (live) or Delete (turned off). */
const linkMenu = (
  share: ShareLinkSummary,
  { manage, remove }: { manage: () => void; remove: () => void },
): DashboardContextMenuGroup[] => {
  const live = share.status === "active";
  const second = live
    ? {
        icon: <ClipboardCopy className="size-4" />,
        label: "Copy link",
        onSelect: () => copyLink(share),
      }
    : {
        icon: <Trash2 className="size-4" />,
        label: "Delete",
        destructive: true,
        onSelect: remove,
      };
  return [
    {
      actions: [
        {
          disabled: share.status === "target-unavailable",
          icon: <Link2 className="size-4" />,
          label: live ? "Manage link" : "Share again",
          onSelect: manage,
        },
        second,
      ],
    },
  ];
};

const linkColumns = (
  now: Date,
  timeZone: string,
): FileListColumn<LinkItem>[] => [
  {
    key: "expires",
    label: "Expires",
    width: "8rem",
    align: "end",
    render: ({ data }) =>
      data.status === "active" ? (
        <span className={cn(soon(data, now) && "text-warning-foreground")}>
          {formatTimeUntil(data.expiresAt, now)}
        </span>
      ) : (
        stoppedLabel(data, timeZone)
      ),
  },
  {
    key: "marks",
    label: "",
    width: "3rem",
    align: "end",
    render: ({ data }) => (
      <span className="inline-flex gap-1.5 [&_svg]:size-3.5">
        {data.hasPassword ? <Lock aria-label="Password" role="img" /> : null}
        {data.downloadDisabled ? (
          <Eye aria-label="View only" role="img" />
        ) : null}
      </span>
    ),
  },
];

/** Live links on top; turned off and expired ones folded below. */
/** Deletes links, says how it went, and offers Retry on a failure. */
const removeLinks = async (targets: ShareLinkSummary[], done: () => void) => {
  try {
    for (const share of targets) await deleteLink(share);
    toast.success(
      targets.length === 1
        ? "Link deleted."
        : `${targets.length} links deleted.`,
    );
  } catch (caught) {
    toast.error(caught instanceof Error ? caught.message : "Delete failed.", {
      retry: () => void removeLinks(targets, done),
    });
  }
  done();
};

function LinkList({
  shares,
  label,
  head,
  view,
  onManage,
  onRemove,
  loading,
  loadAll,
  loadNext,
  onFind,
}: {
  shares: ShareLinkSummary[];
  loading: ListLoading;
  loadAll: () => Promise<ShareLinkSummary[]>;
  loadNext: () => Promise<ShareLinkSummary[]>;
  onFind: () => void;
  label: string;
  head: boolean;
  view: "list" | "grid";
  onManage: (share: ShareLinkSummary) => void;
  onRemove: (targets: ShareLinkSummary[]) => void;
}) {
  const { now, timeZone } = useTime();
  const coarse = useCoarsePointer();
  const selection = useListSelection({
    ids: shares.map((share) => share.id),
    loadAllIds: async () => (await loadAll()).map((share) => share.id),
    loadNextIds: async () => (await loadNext()).map((share) => share.id),
    onFind,
    coarse,
    onOpen: (id) => {
      const share = shares.find((candidate) => candidate.id === id);
      if (share && share.status !== "target-unavailable") onManage(share);
    },
  });
  return (
    <FileList
      loading={loading}
      coarse={coarse}
      columns={linkColumns(now, timeZone)}
      getActions={({ data }) =>
        linkMenu(data, {
          manage: () => onManage(data),
          remove: () => onRemove([data]),
        })
      }
      head={head}
      items={shares.map((share) => toLinkItem(share, now, timeZone))}
      label={label}
      quickActions={({ data }) => (
        <LinkQuickAction share={data} onDelete={() => onRemove([data])} />
      )}
      quickActionsWidth="9.5rem"
      selection={selection}
      subline="always"
      view={view}
    />
  );
}

export function SharedLinks({
  livePage,
  offPage,
}: {
  livePage: ListPage<ShareLinkSummary>;
  offPage: ListPage<ShareLinkSummary>;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [view, setView] = useViewMode("shared");
  const [filterType, setFilterType] = useState<WorkspaceItemFilterType>("all");
  const finder = useListFind("Find in shared links");
  const liveList = useContinuousList({
    name: "shares-live",
    items: livePage.items,
    total: livePage.total,
    query: { filter: filterType, find: finder.find },
    load: (query) => loadShares(true, query),
    select: (query) => selectShares(true, query),
  });
  const offList = useContinuousList({
    name: "shares-off",
    items: offPage.items,
    total: offPage.total,
    query: { filter: filterType, find: finder.find },
    load: (query) => loadShares(false, query),
    select: (query) => selectShares(false, query),
  });

  const [manage, setManage] = useState<ShareLinkSummary | null>(null);
  const refresh = () => startTransition(() => router.refresh());
  const remove = (targets: ShareLinkSummary[]) =>
    void removeLinks(targets, refresh);

  const live = liveList.items;
  const off = offList.items;

  const removeAll = async () => {
    const ok = await confirmAction({
      title: `Delete ${offList.total} turned off links?`,
      confirmLabel: "Delete all",
      destructive: true,
    });
    if (!ok) return;
    try {
      remove(await offList.loadAll());
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : "Links could not load.",
      );
    }
  };

  return (
    <>
      <PageHeader
        actions={
          <TypeAndView
            type={filterType}
            view={view}
            onTypeChange={setFilterType}
            onViewChange={setView}
          />
        }
        title="Shared"
      />

      {finder.field}
      {liveList.total === 0 ? <ListLoadingRow {...liveList} /> : null}
      {offList.total === 0 ? <ListLoadingRow {...offList} /> : null}
      <LinksEmpty
        lists={[liveList, offList]}
        filtered={filterType !== "all" || Boolean(finder.find)}
      />

      {liveList.total > 0 ? (
        <LinkList
          head
          label="Shared links"
          shares={live}
          loading={liveList}
          loadAll={liveList.loadAll}
          loadNext={liveList.loadMore}
          onFind={finder.show}
          view={view}
          onManage={setManage}
          onRemove={remove}
        />
      ) : null}

      {offList.total > 0 ? (
        <Collapsible>
          <div className="flex items-center gap-2 px-1.5 pt-2">
            <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 rounded-sm text-meta font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight
                aria-hidden
                className="size-4 text-muted-foreground transition-transform duration-150 group-data-panel-open:rotate-90 motion-reduce:transition-none"
              />
              Turned off
            </CollapsibleTrigger>
            <Button
              className="ms-auto"
              size="sm"
              variant="ghost-destructive"
              onClick={() => void removeAll()}
            >
              Delete all
            </Button>
          </div>
          <CollapsiblePanel>
            <LinkList
              head={false}
              label="Turned off links"
              shares={off}
              loading={offList}
              loadAll={offList.loadAll}
              loadNext={offList.loadMore}
              onFind={finder.show}
              view={view}
              onManage={setManage}
              onRemove={remove}
            />
          </CollapsiblePanel>
        </Collapsible>
      ) : null}

      {manage ? (
        <ShareDialog
          name={manage.target.name}
          targetType={manage.target.targetType}
          targetId={manage.target.id}
          initialShare={manage}
          onClose={() => {
            setManage(null);
            refresh();
          }}
        />
      ) : null}
    </>
  );
}

function LinksEmpty({
  lists,
  filtered,
}: {
  lists: (ListLoading & { total: number })[];
  filtered: boolean;
}) {
  if (lists.some((list) => list.total > 0 || list.loading || list.error))
    return null;
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyTitle>
          {filtered ? "Nothing matches" : "Nothing shared yet"}
        </EmptyTitle>
      </EmptyHeader>
    </Empty>
  );
}
