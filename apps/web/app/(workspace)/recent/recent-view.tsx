"use client";

import { Clock } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashMessage } from "@/app/auth-ui";
import {
  DashboardPageContextMenu,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { PageHeader } from "@/components/page-header";
import { useTime } from "@/components/time-provider";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  FileList,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { useListSort } from "@/components/file-list/use-list-sort";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { formatRelativeTime } from "@/lib/time";

import { SelectionBar } from "../selection-bar";
import {
  toWorkspaceListItem,
  listBackgroundMenu,
  ListToolbar,
} from "../workspace-list-parts";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  downloadAndTrash,
  liveItemMenu,
  useWorkspaceItemActions,
} from "../use-workspace-item-actions";
import { sizeColumn } from "../workspace-item-helpers";
import {
  filterRecentItems,
  groupRecentItems,
  sortRecentItems,
  type RecentClientItem,
  type RecentFilterType,
  type RecentSortKey,
} from "./recent-helpers";

type RecentViewProps = {
  error?: string | null;
  items: RecentClientItem[];
  success?: string | null;
};

type RecentListItem = FileListItem & { data: RecentClientItem };

export function RecentView({ error, items, success }: RecentViewProps) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("recent");
  const [filterType, setFilterType] = useState<RecentFilterType>("all");
  const sort = useListSort<RecentSortKey>("uploadedAt", "desc");
  const actions = useWorkspaceItemActions("/recent");

  // Items stay in Recent after trashing, faded, so they can come back.
  const visibleItems = useMemo(
    () =>
      sortRecentItems(
        filterRecentItems(
          items.map((item) =>
            actions.trashedIds.has(item.id) && !item.deletedAt
              ? { ...item, deletedAt: new Date().toISOString() }
              : item,
          ),
          filterType,
        ),
        sort.key,
        sort.direction,
      ),
    [actions.trashedIds, filterType, items, sort.direction, sort.key],
  );

  const toListItem = (item: RecentClientItem): RecentListItem => ({
    ...toWorkspaceListItem(item),
    dimmed: Boolean(item.deletedAt),
    sub: item.deletedAt
      ? "In trash"
      : `${item.locationLabel} · ${formatRelativeTime(item.uploadedAt, now, timeZone)}`,
  });
  const listItems = visibleItems.map(toListItem);
  const groups = groupRecentItems(visibleItems, now, timeZone).map((group) => ({
    label: group.label,
    items: group.items.map(toListItem),
  }));
  const selectable = visibleItems.filter(
    (item) => !item.deletedAt && !item.storageMutationStatus,
  );

  const { selection, selectedItems, targetsFor } = useItemSelection({
    items: selectable,
    coarse: isCoarsePointer,
    onOpen: actions.open,
    onDelete: (targets) => void actions.trash(targets),
  });

  const getActions = ({
    data: item,
  }: RecentListItem): DashboardContextMenuGroup[] => {
    if (item.deletedAt) {
      return buildItemActions({
        name: item.name,
        kind: item.kind,
        restore: () => void actions.restore(item),
      });
    }
    return liveItemMenu(actions, item, targetsFor(item), selection.clear);
  };

  const columns: FileListColumn<RecentListItem>[] = [
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
      key: "uploadedAt",
      label: "Added",
      width: "7rem",
      align: "end",
      sortable: true,
      render: (item) =>
        item.data.deletedAt
          ? "In trash"
          : formatRelativeTime(item.data.uploadedAt, now, timeZone),
    },
  ];

  const backgroundGroups = listBackgroundMenu(
    actions.refresh,
    selection.selectAll,
    selectable.length,
  );

  return (
    <DashboardPageContextMenu
      className="grid min-h-0 content-start gap-4"
      groups={backgroundGroups}
    >
      <PageHeader title="Recent" />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actions.error ? <FlashMessage>{actions.error}</FlashMessage> : null}

      <ListToolbar
        filter={filterType}
        view={view}
        onFilterChange={setFilterType}
        onViewChange={setView}
      />

      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        empty={
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {items.length === 0
                  ? "Nothing added yet"
                  : "Nothing of that type"}
              </EmptyTitle>
              <EmptyDescription>
                {items.length === 0
                  ? "Files and folders you add show up here."
                  : "Try another type."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        getActions={getActions}
        groups={groups}
        items={listItems}
        label="Recent files"
        selection={selection}
        sort={sort}
        view={view}
      />

      <SelectionBar
        actions={downloadAndTrash(actions, selectedItems, selection.clear)}
        count={selectedItems.length}
        onClear={selection.clear}
      />
    </DashboardPageContextMenu>
  );
}
