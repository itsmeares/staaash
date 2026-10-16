"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  DashboardPageContextMenu,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { PageHeader } from "@/components/page-header";
import { useTime } from "@/components/time-provider";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTab } from "@/components/ui/tabs";
import {
  FileList,
  thumbnailUrlFor,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { useListSort } from "@/components/file-list/use-list-sort";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { formatGroupedTime, formatRelativeTime, groupByDate } from "@/lib/time";

import { SelectionBar } from "../selection-bar";
import {
  TypeAndView,
  toWorkspaceListItem,
  listBackgroundMenu,
} from "../workspace-list-parts";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  downloadAndTrash,
  liveItemMenu,
  useWorkspaceItemActions,
} from "../use-workspace-item-actions";
import { sizeColumn } from "../workspace-item-helpers";
import {
  ACTION_LABELS,
  batchActivity,
  batchLabel,
  filterRecentItems,
  sortRecentItems,
  type ActivityRow,
  type RecentClientItem,
  type RecentFilterType,
  type RecentSortKey,
} from "./recent-helpers";

type RecentListItem = FileListItem & { data: ActivityRow };

const folderOf = (item: RecentClientItem) =>
  item.locationLabel === "/" ? "Files" : item.locationLabel;

/** A batch's thumbnails, up to five, then "+N". */
function BatchStrip({ items }: { items: RecentClientItem[] }) {
  const shown = items.slice(0, 5);
  return (
    <span className="flex gap-1.25 pt-1.5">
      {shown.map((item) => (
        <img
          alt=""
          className="h-10.5 w-14 rounded-md bg-muted object-cover max-sm:h-8.5 max-sm:w-11"
          decoding="async"
          key={item.id}
          loading="lazy"
          src={thumbnailUrlFor(item) ?? undefined}
        />
      ))}
      {items.length > shown.length ? (
        <span className="grid h-10.5 w-14 place-items-center rounded-md bg-hover text-label text-muted-foreground max-sm:h-8.5 max-sm:w-11">
          +{items.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}

/** Activity (Opened, Uploaded, …) or everything added, newest first. */
export function RecentView({
  items,
  show,
}: {
  items: RecentClientItem[];
  show: "activity" | "added";
}) {
  const router = useRouter();
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone, clock } = useTime();
  const [view, setView] = useViewMode("recent");
  const [filterType, setFilterType] = useState<RecentFilterType>("all");
  const sort = useListSort<RecentSortKey>("at", "desc");
  const actions = useWorkspaceItemActions("/recent");
  const activity = show === "activity";

  // Items stay after trashing, faded, so they can come back.
  const visibleItems = useMemo(() => {
    const marked = filterRecentItems(
      items.map((item) =>
        actions.trashedIds.has(item.id) && !item.deletedAt
          ? { ...item, deletedAt: new Date().toISOString() }
          : item,
      ),
      filterType,
    );
    return activity
      ? marked
      : sortRecentItems(marked, sort.key, sort.direction);
  }, [
    actions.trashedIds,
    activity,
    filterType,
    items,
    sort.direction,
    sort.key,
  ]);

  // The timeline grid shows every item; the activity list folds bursts.
  const rows: ActivityRow[] =
    activity && view === "list" ? batchActivity(visibleItems) : visibleItems;

  const whenOf = (item: ActivityRow) => {
    const time = formatGroupedTime(item.at, now, timeZone, clock);
    if (item.batch) return time;
    if (item.deletedAt && item.lastAction !== "trashed") return "In trash";
    return item.lastAction
      ? `${ACTION_LABELS[item.lastAction]} · ${time}`
      : time;
  };

  const toListItem = (row: ActivityRow): RecentListItem =>
    row.batch
      ? {
          id: row.id,
          kind: "file",
          name: batchLabel(row),
          mimeType: row.mimeType,
          sub: <BatchStrip items={row.batch} />,
          data: row,
        }
      : {
          ...toWorkspaceListItem(row),
          dimmed: Boolean(row.deletedAt),
          // Narrow lists say what happened under the name; wide ones have
          // a column for it and show the folder there instead.
          sub: activity ? (
            <>
              <span className="@xl/list:hidden">{whenOf(row)}</span>
              <span className="hidden @xl/list:inline">{folderOf(row)}</span>
            </>
          ) : row.deletedAt ? (
            "In trash"
          ) : (
            `${row.locationLabel} · ${formatRelativeTime(row.at, now, timeZone)}`
          ),
          data: row,
        };
  const listItems = rows.map(toListItem);
  const groups =
    activity || sort.key === "at"
      ? groupByDate(
          rows,
          (row) => row.at,
          now,
          timeZone,
          sort.direction === "asc" && !activity,
        ).map((group) => ({
          label: group.label,
          items: group.items.map(toListItem),
        }))
      : undefined;
  const selectable = rows.filter(
    (row) => !row.deletedAt && !row.storageMutationStatus,
  );
  const itemsOf = (picked: ActivityRow[]) =>
    picked.flatMap((row) => row.batch ?? [row]);

  const { selection, selectedItems, targetsFor } = useItemSelection({
    items: selectable,
    coarse: isCoarsePointer,
    onOpen: (row) =>
      row.batch ? actions.showInFolder(row) : actions.open(row),
    onDelete: (targets) => void actions.trash(itemsOf(targets)),
  });

  const getActions = ({
    data: row,
  }: RecentListItem): DashboardContextMenuGroup[] => {
    if (row.deletedAt) {
      return buildItemActions({
        name: row.name,
        kind: row.kind,
        restore: () => void actions.restore(row),
      });
    }
    const targets = itemsOf(targetsFor(row));
    if (row.batch) {
      return buildItemActions({
        name: batchLabel(row),
        kind: "file",
        count: targets.length,
        open: () => actions.showInFolder(row),
        openLabel: "Show in folder",
        download: () => void actions.download(targets),
        trash: () => {
          void actions.trash(targets);
          selection.clear();
        },
      });
    }
    return liveItemMenu(actions, row, targets, selection.clear);
  };

  const columns: FileListColumn<RecentListItem>[] = activity
    ? [
        {
          key: "when",
          label: "When",
          width: "11.25rem",
          align: "end",
          render: (item) => whenOf(item.data),
        },
      ]
    : [
        {
          key: "path",
          label: "Location",
          width: "minmax(0,0.8fr)",
          priority: "wide",
          sortable: true,
          render: (item) => item.data.locationLabel,
        },
        { ...sizeColumn<RecentListItem>(), sortable: true },
        {
          key: "at",
          label: "Added",
          width: "7rem",
          align: "end",
          sortable: true,
          render: (item) =>
            item.data.deletedAt
              ? "In trash"
              : formatRelativeTime(item.data.at, now, timeZone),
        },
      ];

  const backgroundGroups = listBackgroundMenu(
    actions.refresh,
    selection.selectAll,
    selectable.length,
  );
  const picked = itemsOf(selectedItems);

  return (
    <DashboardPageContextMenu
      className="grid min-h-0 content-start gap-4"
      groups={backgroundGroups}
    >
      <PageHeader
        actions={
          <>
            <Tabs
              value={show}
              onValueChange={(next) =>
                router.push(next === "added" ? "/recent?show=added" : "/recent")
              }
            >
              <TabsList aria-label="Show" size="sm">
                <TabsTab value="activity">Activity</TabsTab>
                <TabsTab value="added">Added</TabsTab>
              </TabsList>
            </Tabs>
            <TypeAndView
              type={filterType}
              view={view}
              onTypeChange={setFilterType}
              onViewChange={setView}
            />
          </>
        }
        title="Recent"
      />

      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        empty={
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyTitle>
                {items.length === 0
                  ? "Nothing here yet"
                  : "Nothing of that type"}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
        getActions={getActions}
        groups={groups}
        head={!activity}
        items={listItems}
        label="Recent files"
        selection={selection}
        sort={activity ? undefined : sort}
        tiles={activity}
        view={view}
      />

      <SelectionBar
        actions={downloadAndTrash(actions, picked, selection.clear)}
        count={picked.length}
        onClear={selection.clear}
      />
    </DashboardPageContextMenu>
  );
}
