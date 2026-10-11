"use client";

import { Download, Heart, HeartOff } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashMessage } from "@/app/auth-ui";
import { DashboardPageContextMenu } from "@/app/dashboard-context-menu";
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
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { useListSort } from "@/components/file-list/use-list-sort";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { formatRelativeTime } from "@/lib/time";

import { SelectionBar } from "../selection-bar";
import {
  toWorkspaceListItem,
  listBackgroundMenu,
  ListToolbar,
  PinnedChips,
} from "../workspace-list-parts";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  liveItemMenu,
  useWorkspaceItemActions,
} from "../use-workspace-item-actions";
import { sizeColumn } from "../workspace-item-helpers";
import {
  filterFavoriteItems,
  getQuickAccessFavorites,
  sortFavoriteItems,
  type FavoriteClientItem,
  type FavoriteFilterType,
  type FavoriteSortKey,
} from "./favorites-helpers";

type FavoritesViewProps = {
  error?: string | null;
  items: FavoriteClientItem[];
  success?: string | null;
};

type FavoriteListItem = FileListItem & { data: FavoriteClientItem };

// Favorites adds optimistic remove and pin on top of the shared list.
// fallow-ignore-next-line complexity
export function FavoritesView({ error, items, success }: FavoritesViewProps) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("favorites");
  const [filterType, setFilterType] = useState<FavoriteFilterType>("all");
  const sort = useListSort<FavoriteSortKey>("favoritedAt", "desc");
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
        sort.key,
        sort.direction,
      ),
    [activeItems, filterType, sort.direction, sort.key],
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

  const { selection, selectedItems, targetsFor } = useItemSelection({
    items: selectable,
    coarse: isCoarsePointer,
    onOpen: actions.open,
  });

  const getActions = (item: FavoriteClientItem) => {
    const pinned = item.quickAccessPinnedAt != null;
    return liveItemMenu(actions, item, targetsFor(item), selection.clear, {
      favorite: { isFavorite: true, run: () => void unfavorite([item]) },
      pin: { pinned, run: () => void setPinned(item, !pinned) },
    });
  };

  const listItems: FavoriteListItem[] = visibleItems.map(toWorkspaceListItem);

  const columns: FileListColumn<FavoriteListItem>[] = [
    {
      key: "path",
      label: "Location",
      width: "minmax(0,0.8fr)",
      priority: "wide",
      sortable: true,
      render: (item) => item.data.locationLabel,
    },
    { ...sizeColumn<FavoriteListItem>(), sortable: true },
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
          <PinnedChips
            items={pinnedItems}
            menuFor={getActions}
            onOpen={actions.open}
          />
        </section>
      ) : null}

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
        sort={sort}
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
