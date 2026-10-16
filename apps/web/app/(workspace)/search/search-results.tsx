"use client";

import { FolderOpen } from "lucide-react";
import type { ReactNode } from "react";

import { useTime } from "@/components/time-provider";
import { Button } from "@/components/ui/button";
import {
  FileList,
  Highlight,
  type FileListColumn,
  type FileListItem,
} from "@/components/file-list/file-list";
import { useItemSelection } from "@/components/file-list/use-list-selection";
import { useViewMode } from "@/components/file-list/use-view-mode";
import { PageHeader } from "@/components/page-header";
import { ViewToggle } from "@/components/view-toggle";
import { formatRelativeTime } from "@/lib/time";

import type { RecentClientItem } from "../recent/recent-helpers";
import { SelectionBar } from "../selection-bar";
import { toWorkspaceListItem } from "../workspace-list-parts";
import { useCoarsePointer } from "../use-coarse-pointer";
import {
  downloadAndTrash,
  liveItemMenu,
  useWorkspaceItemActions,
} from "../use-workspace-item-actions";
import { sizeColumn } from "../workspace-item-helpers";

type SearchListItem = FileListItem & { data: RecentClientItem };

/** Results with their header, which holds the list or grid choice. */
export function SearchResults({
  items,
  query,
  currentPath,
  title,
  description,
  notices,
}: {
  items: RecentClientItem[];
  query: string;
  currentPath: string;
  title: string;
  description?: string;
  /** Messages from the last action, shown under the header. */
  notices: ReactNode;
}) {
  const isCoarsePointer = useCoarsePointer();
  const { now, timeZone } = useTime();
  const [view, setView] = useViewMode("search");
  const actions = useWorkspaceItemActions(currentPath);
  const visible = items.filter((item) => !actions.trashedIds.has(item.id));
  const selectable = visible.filter((item) => !item.storageMutationStatus);

  const { selection, selectedItems, targetsFor } = useItemSelection({
    items: selectable,
    coarse: isCoarsePointer,
    onOpen: actions.open,
  });

  const listItems: SearchListItem[] = visible.map(toWorkspaceListItem);

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
        actions={<ViewToggle value={view} onValueChange={setView} />}
        description={description}
        title={title}
      />
      {notices}
      <FileList
        coarse={isCoarsePointer}
        columns={columns}
        getActions={({ data: item }) =>
          liveItemMenu(actions, item, targetsFor(item), selection.clear)
        }
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
        actions={downloadAndTrash(actions, selectedItems, selection.clear)}
        count={selectedItems.length}
        onClear={selection.clear}
      />
    </>
  );
}
