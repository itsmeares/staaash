"use client";

import { FolderOpen } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { DashboardItemContextMenu } from "@/app/dashboard-context-menu";
import { useTime } from "@/components/time-provider";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import {
  FileList,
  Highlight,
  ItemIcon,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { PageHeader } from "@/components/page-header";
import { formatRelativeTime } from "@/lib/time";

import type { RecentClientItem } from "../recent/recent-helpers";
import { SelectionBar } from "../selection-bar";
import { TypeAndView, toWorkspaceListItem } from "../workspace-list-parts";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  downloadAndTrash,
  liveItemMenu,
  useWorkspaceItemActions,
} from "../use-workspace-item-actions";
import {
  filterWorkspaceItems,
  sizeColumn,
  type WorkspaceItemFilterType,
} from "../workspace-item-helpers";

type SearchListItem = FileListItem & { data: RecentClientItem };

/** Matching folders as tiles, then the matching files as a list. */
export function SearchResults({
  items,
  query,
  currentPath,
  title,
}: {
  items: RecentClientItem[];
  query: string;
  currentPath: string;
  title: ReactNode;
}) {
  const router = useRouter();
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("search");
  const [filterType, setFilterType] = useState<WorkspaceItemFilterType>("all");
  const actions = useWorkspaceItemActions(currentPath);
  const visible = filterWorkspaceItems(
    items.filter((item) => !actions.trashedIds.has(item.id)),
    filterType,
  );
  const folders = visible.filter((item) => item.kind === "folder");
  const files = visible.filter(
    (item) => item.kind === "file" && !item.storageMutationStatus,
  );

  const { selection, selectedItems, targetsFor } = useItemSelection({
    items: files,
    coarse: isCoarsePointer,
    onOpen: actions.open,
  });

  const columns: FileListColumn<SearchListItem>[] = [
    {
      key: "location",
      label: "Location",
      width: "minmax(0,0.8fr)",
      render: (item) => item.data.locationLabel,
    },
    { ...sizeColumn<SearchListItem>(), priority: "wide" },
    {
      key: "modified",
      label: "Modified",
      width: "7rem",
      align: "end",
      priority: "wide",
      render: (item) => formatRelativeTime(item.data.at, now, timeZone),
    },
  ];

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
        title={title}
      />

      {folders.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
          {folders.map((folder) => (
            <DashboardItemContextMenu
              groups={liveItemMenu(actions, folder, [folder])}
              key={folder.id}
            >
              <button
                className="flex min-w-0 cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                type="button"
                onClick={() => router.push(folder.href)}
              >
                <ItemIcon item={folder} />
                <span className="grid min-w-0">
                  <span className="truncate text-body font-medium">
                    <Highlight query={query} text={folder.name} />
                  </span>
                  <span className="truncate text-label text-muted-foreground">
                    {folder.locationLabel === "/"
                      ? "Files"
                      : folder.locationLabel}
                  </span>
                </span>
              </button>
            </DashboardItemContextMenu>
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <FileList
          coarse={isCoarsePointer}
          columns={columns}
          getActions={({ data: item }) =>
            liveItemMenu(actions, item, targetsFor(item), selection.clear)
          }
          items={files.map(toWorkspaceListItem)}
          label={`Files matching ${query}`}
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
      ) : null}

      {folders.length === 0 && files.length === 0 ? (
        <Empty className="min-h-64">
          <EmptyHeader>
            <EmptyTitle>Nothing of that type</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}

      <SelectionBar
        actions={downloadAndTrash(actions, selectedItems, selection.clear)}
        count={selectedItems.length}
        onClear={selection.clear}
        onSelectAll={selection.selectAll}
      />
    </>
  );
}
