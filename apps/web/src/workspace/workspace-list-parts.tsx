import { RefreshCw } from "lucide-react";

import {
  DashboardItemContextMenu,
  type DashboardContextMenuGroup,
} from "@/src/dashboard-context-menu";
import { ItemIcon, thumbnailUrlFor } from "@/components/file-list/file-list";
import { MiddleName } from "@/components/file-list/middle-name";
import { TypeFilter } from "@/components/file-list/type-filter";
import { ViewToggle } from "@/components/view-toggle";

import {
  WORKSPACE_ITEM_FILTERS,
  blockedLabel,
  type WorkspaceItemFilterType,
} from "./workspace-item-helpers";

type ListedItem = {
  id: string;
  kind: "file" | "folder";
  name: string;
  mimeType?: string;
  locationLabel: string;
  storageMutationStatus?: string;
  color?: string | null;
};

/** A Recent, Favorites or Search item as a `FileList` row. */
export const toWorkspaceListItem = <T extends ListedItem>(item: T) => ({
  id: item.id,
  kind: item.kind,
  name: item.name,
  mimeType: item.mimeType,
  color: item.color,
  thumbnailUrl: thumbnailUrlFor(item),
  blocked: blockedLabel(item.storageMutationStatus),
  sub: item.locationLabel,
  data: item,
});

/** Right-click on empty space in a list: Refresh and Select all. */
export const listBackgroundMenu = (
  refresh: () => void,
  selectAll: () => void,
  selectableCount: number,
): DashboardContextMenuGroup[] => [
  {
    actions: [
      {
        icon: <RefreshCw className="size-4" />,
        label: "Refresh",
        onSelect: refresh,
      },
      {
        disabled: selectableCount === 0,
        label: "Select all",
        onSelect: selectAll,
      },
    ],
  },
];

/** Pinned files and folders as chips, on Home and Favorites. */
export function PinnedChips<T extends ListedItem>({
  id,
  items,
  menuFor,
  onOpen,
}: {
  id?: string;
  items: T[];
  menuFor: (item: T) => DashboardContextMenuGroup[];
  onOpen: (item: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" id={id}>
      {items.map((item) => (
        <DashboardItemContextMenu groups={menuFor(item)} key={item.id}>
          <button
            className="flex h-10 max-w-64 min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-card ps-3 pe-3.5 text-body outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
            type="button"
            onClick={() => onOpen(item)}
          >
            <ItemIcon item={item} />
            <MiddleName className="font-medium" name={item.name} />
          </button>
        </DashboardItemContextMenu>
      ))}
    </div>
  );
}

/** The Type button and list/grid, at the right of a list's title. */
export function TypeAndView({
  type,
  onTypeChange,
  view,
  onViewChange,
}: {
  type: WorkspaceItemFilterType;
  onTypeChange: (type: WorkspaceItemFilterType) => void;
  view: "list" | "grid";
  onViewChange: (view: "list" | "grid") => void;
}) {
  return (
    <>
      <TypeFilter
        options={WORKSPACE_ITEM_FILTERS}
        value={type}
        onValueChange={onTypeChange}
      />
      <ViewToggle value={view} onValueChange={onViewChange} />
    </>
  );
}
