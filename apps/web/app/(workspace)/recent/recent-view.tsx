"use client";

import { Clock, Download, RefreshCw, Trash2 } from "lucide-react";
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
import { ViewToggle } from "@/components/view-toggle";
import {
  FileList,
  thumbnailUrlFor,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { TypeFilter } from "@/components/file-list/type-filter";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { formatRelativeTime } from "@/lib/time";

import { SelectionBar } from "../selection-bar";
import { useCoarsePointer } from "../use-coarse-pointer";
import { useWorkspaceItemActions } from "../use-workspace-item-actions";
import {
  formatWorkspaceFileSize,
  WORKSPACE_ITEM_FILTERS,
} from "../workspace-item-helpers";
import {
  filterRecentItems,
  groupRecentItems,
  sortRecentItems,
  type RecentClientItem,
  type RecentFilterType,
  type RecentSortDirection,
  type RecentSortKey,
} from "./recent-helpers";

type RecentViewProps = {
  error?: string | null;
  items: RecentClientItem[];
  success?: string | null;
};

type RecentListItem = FileListItem & { data: RecentClientItem };

const blockedLabel = (status?: string) =>
  status
    ? status === "recovery_required"
      ? "Recovery required"
      : "Finishing storage operation"
    : null;

export function RecentView({ error, items, success }: RecentViewProps) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("recent");
  const [filterType, setFilterType] = useState<RecentFilterType>("all");
  const [sortKey, setSortKey] = useState<RecentSortKey>("uploadedAt");
  const [sortDirection, setSortDirection] =
    useState<RecentSortDirection>("desc");
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
        sortKey,
        sortDirection,
      ),
    [actions.trashedIds, filterType, items, sortDirection, sortKey],
  );

  const toListItem = (item: RecentClientItem): RecentListItem => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    thumbnailUrl: thumbnailUrlFor(item),
    blocked: blockedLabel(item.storageMutationStatus),
    dimmed: Boolean(item.deletedAt),
    sub: item.deletedAt
      ? "In trash"
      : `${item.locationLabel} · ${formatRelativeTime(item.uploadedAt, now, timeZone)}`,
    data: item,
  });
  const listItems = visibleItems.map(toListItem);
  const groups = groupRecentItems(visibleItems, now, timeZone).map((group) => ({
    label: group.label,
    items: group.items.map(toListItem),
  }));
  const selectable = visibleItems.filter(
    (item) => !item.deletedAt && !item.storageMutationStatus,
  );

  const selection = useListSelection({
    ids: selectable.map((item) => item.id),
    coarse: isCoarsePointer,
    onOpen: (id) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) actions.open(item);
    },
    onKey: (event, selected) => {
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selected.length > 0
      ) {
        event.preventDefault();
        void actions.trash(
          selectable.filter((item) => selected.includes(item.id)),
        );
        selection.clear();
        return true;
      }
      return false;
    },
  });
  const selectedItems = selectable.filter((item) =>
    selection.selected.has(item.id),
  );
  const targetsFor = (item: RecentClientItem) =>
    selection.selected.has(item.id) && selectedItems.length > 1
      ? selectedItems
      : [item];

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
    const targets = targetsFor(item);
    return buildItemActions({
      name: item.name,
      kind: item.kind,
      count: targets.length,
      open: () => actions.open(item),
      download: () => void actions.download(targets),
      favorite: {
        isFavorite: item.isFavorite,
        run: () =>
          void actions.setFavorite(item, { isFavorite: !item.isFavorite }),
      },
      trash: () => {
        void actions.trash(targets);
        selection.clear();
      },
    });
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
    {
      key: "size",
      label: "Size",
      width: "6rem",
      align: "end",
      sortable: true,
      render: (item) =>
        item.kind === "folder"
          ? ""
          : formatWorkspaceFileSize(item.data.sizeBytes),
    },
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

  const backgroundGroups: DashboardContextMenuGroup[] = [
    {
      actions: [
        {
          icon: <RefreshCw className="size-4" />,
          label: "Refresh",
          onSelect: actions.refresh,
        },
        {
          disabled: selectable.length === 0,
          label: "Select all",
          onSelect: selection.selectAll,
        },
      ],
    },
  ];

  return (
    <DashboardPageContextMenu
      className="grid min-h-0 content-start gap-4"
      groups={backgroundGroups}
    >
      <PageHeader title="Recent" />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actions.error ? <FlashMessage>{actions.error}</FlashMessage> : null}

      <div className="flex items-center gap-3">
        <TypeFilter
          options={WORKSPACE_ITEM_FILTERS}
          value={filterType}
          onValueChange={setFilterType}
        />
        <ViewToggle
          className="ms-auto shrink-0"
          value={view}
          onValueChange={setView}
        />
      </div>

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
        sort={{
          key: sortKey,
          direction: sortDirection,
          onSort: (key) => {
            const next = key as RecentSortKey;
            if (next === sortKey) {
              setSortDirection((current) =>
                current === "asc" ? "desc" : "asc",
              );
            } else {
              setSortKey(next);
              setSortDirection(
                next === "uploadedAt" || next === "size" ? "desc" : "asc",
              );
            }
          },
        }}
        view={view}
      />

      <SelectionBar
        actions={[
          {
            label: "Download",
            icon: Download,
            onClick: () => void actions.download(selectedItems),
          },
          {
            label: "Trash",
            icon: Trash2,
            destructive: true,
            onClick: () => {
              void actions.trash(selectedItems);
              selection.clear();
            },
          },
        ]}
        count={selectedItems.length}
        onClear={selection.clear}
      />
    </DashboardPageContextMenu>
  );
}
