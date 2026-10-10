"use client";

import { Download, Heart, HeartOff, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashMessage } from "@/app/auth-ui";
import {
  DashboardItemContextMenu,
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
  ItemIcon,
  MiddleName,
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
  filterFavoriteItems,
  getQuickAccessFavorites,
  sortFavoriteItems,
  type FavoriteClientItem,
  type FavoriteFilterType,
  type FavoriteSortDirection,
  type FavoriteSortKey,
} from "./favorites-helpers";

type FavoritesViewProps = {
  error?: string | null;
  items: FavoriteClientItem[];
  success?: string | null;
};

type FavoriteListItem = FileListItem & { data: FavoriteClientItem };

const blockedLabel = (status?: string) =>
  status
    ? status === "recovery_required"
      ? "Recovery required"
      : "Finishing storage operation"
    : null;

export function FavoritesView({ error, items, success }: FavoritesViewProps) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("favorites");
  const [filterType, setFilterType] = useState<FavoriteFilterType>("all");
  const [sortKey, setSortKey] = useState<FavoriteSortKey>("favoritedAt");
  const [sortDirection, setSortDirection] =
    useState<FavoriteSortDirection>("desc");
  // Optimistic changes until the refreshed list arrives.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const [pinOverrides, setPinOverrides] = useState<
    Record<string, string | null>
  >({});
  const actions = useWorkspaceItemActions("/favorites");

  const activeItems = useMemo(
    () =>
      items
        .filter(
          (item) =>
            !removedIds.has(item.id) && !actions.trashedIds.has(item.id),
        )
        .map((item) =>
          Object.hasOwn(pinOverrides, item.id)
            ? { ...item, quickAccessPinnedAt: pinOverrides[item.id] ?? null }
            : item,
        ),
    [actions.trashedIds, items, pinOverrides, removedIds],
  );
  const visibleItems = useMemo(
    () =>
      sortFavoriteItems(
        filterFavoriteItems(activeItems, filterType),
        sortKey,
        sortDirection,
      ),
    [activeItems, filterType, sortDirection, sortKey],
  );
  const pinnedItems = getQuickAccessFavorites(activeItems);
  const selectable = visibleItems.filter((item) => !item.storageMutationStatus);

  const unfavorite = async (targets: FavoriteClientItem[]) => {
    setRemovedIds(
      (current) => new Set([...current, ...targets.map((t) => t.id)]),
    );
    const results = await Promise.all(
      targets.map((item) => actions.setFavorite(item, { isFavorite: false })),
    );
    const failed = new Set(
      targets.filter((_, index) => !results[index]).map((t) => t.id),
    );
    if (failed.size > 0) {
      setRemovedIds(
        (current) => new Set([...current].filter((id) => !failed.has(id))),
      );
    }
  };

  const setPinned = async (item: FavoriteClientItem, pinned: boolean) => {
    const previous = item.quickAccessPinnedAt;
    setPinOverrides((current) => ({
      ...current,
      [item.id]: pinned ? new Date().toISOString() : null,
    }));
    const ok = await actions.setFavorite(item, { quickAccessPinned: pinned });
    if (!ok)
      setPinOverrides((current) => ({ ...current, [item.id]: previous }));
  };

  const selection = useListSelection({
    ids: selectable.map((item) => item.id),
    coarse: isCoarsePointer,
    onOpen: (id) => {
      const item = items.find((candidate) => candidate.id === id);
      if (item) actions.open(item);
    },
  });
  const selectedItems = selectable.filter((item) =>
    selection.selected.has(item.id),
  );

  const getActions = (
    item: FavoriteClientItem,
  ): DashboardContextMenuGroup[] => {
    const targets =
      selection.selected.has(item.id) && selectedItems.length > 1
        ? selectedItems
        : [item];
    const pinned = item.quickAccessPinnedAt != null;
    return buildItemActions({
      name: item.name,
      kind: item.kind,
      count: targets.length,
      open: () => actions.open(item),
      download: () => void actions.download(targets),
      favorite: { isFavorite: true, run: () => void unfavorite([item]) },
      pin: { pinned, run: () => void setPinned(item, !pinned) },
      trash: () => {
        void actions.trash(targets);
        selection.clear();
      },
    });
  };

  const listItems: FavoriteListItem[] = visibleItems.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    blocked: blockedLabel(item.storageMutationStatus),
    sub: item.locationLabel,
    data: item,
  }));

  const columns: FileListColumn<FavoriteListItem>[] = [
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
      key: "favoritedAt",
      label: "Added",
      width: "7rem",
      align: "end",
      sortable: true,
      render: (item) =>
        formatRelativeTime(item.data.favoritedAt, now, timeZone),
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
      <PageHeader title="Favorites" />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actions.error ? <FlashMessage>{actions.error}</FlashMessage> : null}

      {pinnedItems.length > 0 ? (
        <section aria-labelledby="favorites-pinned" className="grid gap-2">
          <h2
            className="m-0 font-sans text-meta font-semibold"
            id="favorites-pinned"
          >
            Pinned
          </h2>
          <div className="flex flex-wrap gap-2">
            {pinnedItems.map((item) => (
              <DashboardItemContextMenu groups={getActions(item)} key={item.id}>
                <button
                  className="flex h-10 max-w-64 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card ps-3 pe-3.5 text-body outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                  type="button"
                  onClick={() => actions.open(item)}
                >
                  <ItemIcon item={item} />
                  <MiddleName className="font-medium" name={item.name} />
                </button>
              </DashboardItemContextMenu>
            ))}
          </div>
        </section>
      ) : null}

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
                <Heart aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {activeItems.length === 0
                  ? "No favorites yet"
                  : "Nothing of that type"}
              </EmptyTitle>
              <EmptyDescription>
                {activeItems.length === 0
                  ? "Add favorites from any file or folder menu. Pin the ones you open most."
                  : "Try another type."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        getActions={(item) => getActions(item.data)}
        items={listItems}
        label="Favorites"
        selection={selection}
        sort={{
          key: sortKey,
          direction: sortDirection,
          onSort: (key) => {
            const next = key as FavoriteSortKey;
            if (next === sortKey) {
              setSortDirection((current) =>
                current === "asc" ? "desc" : "asc",
              );
            } else {
              setSortKey(next);
              setSortDirection(
                next === "favoritedAt" || next === "size" ? "desc" : "asc",
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
            label: "Remove",
            icon: HeartOff,
            onClick: () => {
              void unfavorite(selectedItems);
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
