"use client";

import { RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { FlashMessage } from "@/app/auth-ui";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import { TypeFilter } from "@/components/file-list/type-filter";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { formatRelativeTime } from "@/lib/time";

import { SelectionBar } from "../selection-bar";
import { useCoarsePointer } from "../use-coarse-pointer";
import { formatWorkspaceFileSize } from "../workspace-item-helpers";
import { EmptyTrashAction } from "./trash-file-actions";
import {
  filterTrashItems,
  groupTrashItems,
  sortTrashItems,
  TRASH_FILTERS,
  type TrashClientItem,
  type TrashFilterType,
} from "./trash-helpers";

type TrashViewProps = {
  error?: string | null;
  items: TrashClientItem[];
  success?: string | null;
  retentionDays: number;
};

type TrashListItem = FileListItem & { data: TrashClientItem };

const kindPath = (item: TrashClientItem) =>
  item.kind === "folder" ? "folders" : "files";

export function TrashView({
  error,
  items,
  success,
  retentionDays,
}: TrashViewProps) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [filterType, setFilterType] = useState<TrashFilterType>("all");
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [actionError, setActionError] = useState<string | null>(null);

  const visibleItems = useMemo(
    () => sortTrashItems(filterTrashItems(items, filterType), sortOrder),
    [filterType, items, sortOrder],
  );
  const selectable = visibleItems.filter((item) => !item.storageMutationStatus);

  // Trash changes reload the page so the list, the counts and the storage meter agree.
  const run = async (
    targets: TrashClientItem[],
    action: "restore" | "delete",
  ) => {
    try {
      for (const item of targets) {
        await submitStorageMutationPost({
          action: `/api/files/${kindPath(item)}/${item.id}/${action}`,
          fields: { redirectTo: "/trash" },
          logicalAction: `trash-${action}:${item.kind}:${item.id}`,
        });
      }
      window.location.reload();
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : action === "restore"
            ? "Restore failed."
            : "Delete failed.",
      );
    }
  };
  const deleteForever = (item: TrashClientItem) => {
    if (
      window.confirm(`Delete ${item.name} for good? This cannot be undone.`)
    ) {
      void run([item], "delete");
    }
  };

  const selection = useListSelection({
    ids: selectable.map((item) => item.id),
    coarse: isCoarsePointer,
    onOpen: () => {},
  });
  const selectedItems = selectable.filter((item) =>
    selection.selected.has(item.id),
  );

  const toListItem = (item: TrashClientItem): TrashListItem => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    blocked: item.storageMutationStatus
      ? item.storageMutationStatus === "recovery_required"
        ? "Recovery required"
        : "Finishing storage operation"
      : null,
    sub: `From ${item.originalPathLabel} · ${formatRelativeTime(item.deletedAt, now, timeZone)}`,
    data: item,
  });
  const groups = groupTrashItems(visibleItems, sortOrder, now, timeZone).map(
    (group) => ({
      label: group.label,
      items: group.items.map(toListItem),
    }),
  );

  const columns: FileListColumn<TrashListItem>[] = [
    {
      key: "from",
      label: "Restores to",
      width: "minmax(0,0.8fr)",
      priority: "wide",
      render: (item) => (
        <span title={`Restores to ${item.data.restoreTargetLabel}`}>
          {item.data.originalPathLabel}
        </span>
      ),
    },
    {
      key: "size",
      label: "Size",
      width: "6rem",
      align: "end",
      render: (item) =>
        item.kind === "folder"
          ? ""
          : formatWorkspaceFileSize(item.data.sizeBytes),
    },
    {
      key: "deleted",
      label: "Deleted",
      width: "7rem",
      align: "end",
      render: (item) => formatRelativeTime(item.data.deletedAt, now, timeZone),
    },
  ];

  return (
    <div className="grid min-h-0 content-start gap-4">
      <PageHeader
        actions={<EmptyTrashAction disabled={items.length === 0} />}
        description={`Items here are deleted for good after ${retentionDays} days.`}
        title="Trash"
      />

      {error ? <FlashMessage>{error}</FlashMessage> : null}
      {success ? <FlashMessage tone="success">{success}</FlashMessage> : null}
      {actionError ? <FlashMessage>{actionError}</FlashMessage> : null}

      <div className="flex items-center gap-3">
        <TypeFilter
          options={TRASH_FILTERS}
          value={filterType}
          onValueChange={setFilterType}
        />
        <TypeFilter
          label="Order"
          options={[
            { id: "newest" as const, label: "Newest first" },
            { id: "oldest" as const, label: "Oldest first" },
          ]}
          value={sortOrder}
          onValueChange={setSortOrder}
        />
      </div>

      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        empty={
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Trash2 aria-hidden />
              </EmptyMedia>
              <EmptyTitle>
                {items.length === 0 ? "Trash is empty" : "Nothing of that type"}
              </EmptyTitle>
              <EmptyDescription>
                {items.length === 0
                  ? "Things you delete wait here before they're gone for good."
                  : "Try another type."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        getActions={({ data: item }) => {
          const targets =
            selection.selected.has(item.id) && selectedItems.length > 1
              ? selectedItems
              : [item];
          return buildItemActions({
            name: item.name,
            kind: item.kind,
            count: targets.length,
            restore: () => void run(targets, "restore"),
            // Folders leave trash with Empty trash, which removes the whole tree.
            deleteForever:
              item.kind === "file" && targets.length === 1
                ? () => deleteForever(item)
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
