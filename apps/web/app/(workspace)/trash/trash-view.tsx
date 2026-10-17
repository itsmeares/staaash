"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { PageHeader } from "@/components/page-header";
import { confirmAction } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useTime } from "@/components/time-provider";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  FileList,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { TypeFilter } from "@/components/file-list/type-filter";
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { useListSort } from "@/components/file-list/use-list-sort";
import { formatRelativeTime, groupByDate } from "@/lib/time";

import { SelectionBar } from "../selection-bar";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  WORKSPACE_ITEM_FILTERS,
  blockedLabel,
  filterWorkspaceItems,
  sizeColumn,
  type WorkspaceItemFilterType,
} from "../workspace-item-helpers";
import { moveTrash, showUndo } from "../undo";
import { EmptyTrashAction } from "./trash-file-actions";
import {
  sortTrashItems,
  type TrashClientItem,
  daysLeft,
  daysLeftLabel,
  type TrashSortKey,
} from "./trash-helpers";

type TrashViewProps = {
  items: TrashClientItem[];
  retentionDays: number;
};

type TrashListItem = FileListItem & { data: TrashClientItem };

const kindPath = (item: TrashClientItem) =>
  item.kind === "folder" ? "folders" : "files";

export function TrashView({ items, retentionDays }: TrashViewProps) {
  const router = useRouter();
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [filterType, setFilterType] = useState<WorkspaceItemFilterType>("all");
  const sort = useListSort<TrashSortKey>("deletedAt", "desc");

  const visibleItems = useMemo(
    () =>
      sortTrashItems(
        filterWorkspaceItems(items, filterType),
        sort.key,
        sort.direction,
      ),
    [filterType, items, sort.direction, sort.key],
  );
  const selectable = visibleItems.filter((item) => !item.storageMutationStatus);

  // Trash changes reload the page so the list, the counts and the storage meter agree.
  const run = async (
    targets: TrashClientItem[],
    action: "restore" | "delete",
  ) => {
    if (action === "restore") {
      const restored = await moveTrash(targets, "restore", "/trash");
      if (restored.length < targets.length) toast.error("Restore failed.");
      router.refresh();
      showUndo({
        items: restored,
        done: "restore",
        redirectTo: "/trash",
        onUndone: () => router.refresh(),
      });
      return;
    }
    try {
      for (const item of targets) {
        await submitStorageMutationPost({
          action: `/api/files/${kindPath(item)}/${item.id}/delete`,
          fields: { redirectTo: "/trash" },
          logicalAction: `trash-delete:${item.kind}:${item.id}`,
        });
      }
      router.refresh();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "Delete failed.");
    }
  };
  const deleteForever = async (item: TrashClientItem) => {
    const ok = await confirmAction({
      title: `Delete ${item.name} for good?`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) void run([item], "delete");
  };

  const { selection, selectedItems, targetsFor } = useItemSelection({
    items: selectable,
    coarse: isCoarsePointer,
  });

  const toListItem = (item: TrashClientItem): TrashListItem => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    blocked: blockedLabel(item.storageMutationStatus),
    sub: `From ${item.locationLabel} · ${formatRelativeTime(item.deletedAt, now, timeZone)}`,
    data: item,
  });
  const groups = groupByDate(
    visibleItems,
    (item) => item.deletedAt,
    now,
    timeZone,
    (sort.key === "deletedAt" || sort.key === "left") &&
      sort.direction === "asc",
  ).map((group) => ({
    label: group.label,
    items: group.items.map(toListItem),
  }));

  const columns: FileListColumn<TrashListItem>[] = [
    {
      key: "path",
      label: "Restores to",
      width: "minmax(0,0.8fr)",
      priority: "wide",
      sortable: true,
      render: (item) => (
        <span title={`Restores to ${item.data.restoreTargetLabel}`}>
          {item.data.locationLabel}
        </span>
      ),
    },
    { ...sizeColumn<TrashListItem>(), sortable: true },
    {
      key: "deletedAt",
      label: "Deleted",
      width: "7rem",
      align: "end",
      sortable: true,
      render: (item) => formatRelativeTime(item.data.deletedAt, now, timeZone),
    },
    {
      key: "left",
      label: "Left",
      width: "6rem",
      align: "end",
      sortable: true,
      render: (item) => {
        const days = daysLeft(
          item.data.deletedAt,
          retentionDays,
          now,
          timeZone,
        );
        return (
          <span className={days <= 3 ? "text-warning-foreground" : undefined}>
            {daysLeftLabel(days)}
          </span>
        );
      },
    },
  ];

  return (
    <div className="grid min-h-0 content-start gap-4">
      <PageHeader
        actions={
          <>
            <TypeFilter
              options={WORKSPACE_ITEM_FILTERS}
              value={filterType}
              onValueChange={setFilterType}
            />
            <EmptyTrashAction disabled={items.length === 0} />
          </>
        }
        title="Trash"
      />

      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        empty={
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyTitle>
                {items.length === 0 ? "Trash is empty" : "Nothing of that type"}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
        getActions={({ data: item }) => {
          const targets = targetsFor(item);
          return buildItemActions({
            name: item.name,
            kind: item.kind,
            count: targets.length,
            restore: () => void run(targets, "restore"),
            // Folders leave trash with Empty trash, which removes the whole tree.
            deleteForever:
              item.kind === "file" && targets.length === 1
                ? () => void deleteForever(item)
                : undefined,
          });
        }}
        groups={groups}
        items={groups.flatMap((group) => group.items)}
        label="Trash"
        quickActions={({ data: item }) => (
          <Button
            aria-label={`Restore ${item.name}`}
            size="icon-sm"
            title="Restore"
            variant="ghost-muted"
            onClick={(event) => {
              event.stopPropagation();
              void run([item], "restore");
            }}
          >
            <RotateCcw aria-hidden />
          </Button>
        )}
        selection={selection}
        sort={sort}
      />

      <SelectionBar
        actions={[
          {
            label: "Restore",
            icon: RotateCcw,
            onClick: () => void run(selectedItems, "restore"),
          },
        ]}
        count={selectedItems.length}
        onClear={selection.clear}
      />
    </div>
  );
}
