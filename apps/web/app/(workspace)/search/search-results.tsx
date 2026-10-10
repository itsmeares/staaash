"use client";

import { Download, FolderOpen, Trash2 } from "lucide-react";

import { FlashMessage } from "@/app/auth-ui";
import { useTime } from "@/components/time-provider";
import { Button } from "@/components/ui/button";
import {
  FileList,
  Highlight,
  thumbnailUrlFor,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { buildItemActions } from "@/components/file-list/item-actions";
import { useListSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { ViewToggle } from "@/components/view-toggle";
import { formatRelativeTime } from "@/lib/time";

import type { RecentClientItem } from "../recent/recent-helpers";
import { SelectionBar } from "../selection-bar";
import { useCoarsePointer } from "../use-coarse-pointer";
import { useWorkspaceItemActions } from "../use-workspace-item-actions";
import { formatWorkspaceFileSize } from "../workspace-item-helpers";

type SearchListItem = FileListItem & { data: RecentClientItem };

export function SearchResults({
  items,
  query,
  currentPath,
}: {
  items: RecentClientItem[];
  query: string;
  currentPath: string;
}) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("search");
  const actions = useWorkspaceItemActions(currentPath);
  const visible = items.filter((item) => !actions.trashedIds.has(item.id));
  const selectable = visible.filter((item) => !item.storageMutationStatus);

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

  const listItems: SearchListItem[] = visible.map((item) => ({
    id: item.id,
    kind: item.kind,
    name: item.name,
    mimeType: item.mimeType,
    thumbnailUrl: thumbnailUrlFor(item),
    blocked: item.storageMutationStatus ? "Finishing storage operation" : null,
    sub: item.locationLabel,
    data: item,
  }));

  const columns: FileListColumn<SearchListItem>[] = [
    {
      key: "location",
      label: "Location",
      width: "minmax(0,0.8fr)",
      render: (item) => item.data.locationLabel,
    },
    {
      key: "size",
      label: "Size",
      width: "6rem",
      align: "end",
      priority: "wide",
      render: (item) =>
        item.kind === "folder"
          ? ""
          : formatWorkspaceFileSize(item.data.sizeBytes),
    },
    {
      key: "modified",
      label: "Modified",
      width: "7rem",
      align: "end",
      priority: "wide",
      render: (item) => formatRelativeTime(item.data.uploadedAt, now, timeZone),
    },
  ];

  return (
    <>
      {actions.error ? <FlashMessage>{actions.error}</FlashMessage> : null}
      <div className="flex justify-end">
        <ViewToggle value={view} onValueChange={setView} />
      </div>
      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        getActions={({ data: item }) => {
          const targets =
            selection.selected.has(item.id) && selectedItems.length > 1
              ? selectedItems
              : [item];
          return buildItemActions({
            name: item.name,
            kind: item.kind,
            count: targets.length,
            open: () => actions.open(item),
            download: () => void actions.download(targets),
            favorite: {
              isFavorite: item.isFavorite,
              run: () =>
                void actions.setFavorite(item, {
                  isFavorite: !item.isFavorite,
                }),
            },
            trash: () => {
              void actions.trash(targets);
              selection.clear();
            },
          });
        }}
        items={listItems}
        label={`Results for ${query}`}
        quickActions={({ data: item }) => (
          <Button
            aria-label={`Show ${item.name} in its folder`}
            size="icon-sm"
            title="Show in folder"
            variant="ghost-muted"
            onClick={(event) => {
              event.stopPropagation();
              actions.showInFolder(item);
            }}
          >
            <FolderOpen aria-hidden />
          </Button>
        )}
        renderName={(item) => (
          <span className="block truncate font-medium" title={item.name}>
            <Highlight query={query} text={item.name} />
          </span>
        )}
        selection={selection}
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
    </>
  );
}
