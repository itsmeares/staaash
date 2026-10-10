"use client";

import { ArrowDown, ArrowUp, Check, MoreHorizontal } from "lucide-react";
import {
  Fragment,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { LucideIcon } from "lucide-react";

import {
  DashboardItemContextMenu,
  DashboardMenuItems,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { ItemTypeIcon } from "@/app/item-type-icon";
import { getItemVisual } from "@/app/item-visuals";
import { WorkspaceActionSheet } from "./action-sheet";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { canHaveThumbnail } from "@staaash/db/viewer-contract";
import { cn } from "@/lib/utils";

import { splitName } from "./list-model";
import type { ListSelection } from "./use-list-selection";

export type FileListItem = {
  id: string;
  kind: "folder" | "file";
  name: string;
  mimeType?: string | null;
  /** A custom folder icon. */
  icon?: LucideIcon;
  thumbnailUrl?: string | null;
  /** Why the item cannot be used right now, such as a storage operation. */
  blocked?: string | null;
  /** Shown faded: cut items, items in trash. */
  dimmed?: boolean;
  /** Small marks after the name: shared, favorite. */
  flags?: ReactNode;
  /** Second line on phones and in grid cards. */
  sub?: ReactNode;
};

export type FileListColumn<T> = {
  key: string;
  label: string;
  /** A CSS grid track, such as "7rem" or "minmax(0,1fr)". */
  width: string;
  align?: "end";
  /** "wide" columns only show when the list has room for all of them. */
  priority?: "wide";
  render: (item: T) => ReactNode;
  sortable?: boolean;
};

export type FileListSort = {
  key: string;
  direction: "asc" | "desc";
  onSort: (key: string) => void;
};

export type FileListGroup<T> = { label: string; items: T[] };

type FileListProps<T extends FileListItem> = {
  label: string;
  items: T[];
  groups?: FileListGroup<T>[];
  columns: FileListColumn<T>[];
  view?: "list" | "grid";
  selection: ListSelection;
  coarse: boolean;
  getActions?: (item: T) => DashboardContextMenuGroup[];
  /** Quick buttons at the end of a row on hover, before "More actions". */
  quickActions?: (item: T) => ReactNode;
  /** Replaces the name, for inline rename. */
  renderName?: (item: T) => ReactNode | undefined;
  /** Extra props per item, for drag and drop. */
  itemProps?: (item: T) => HTMLAttributes<HTMLDivElement>;
  /** Extra classes per item, for drop targets and highlights. */
  itemClassName?: (item: T) => string | undefined;
  sort?: FileListSort;
  empty?: ReactNode;
  /** Rendered after the items, inside the list. */
  children?: ReactNode;
  className?: string;
};

const CHECK_TRACK = "1.75rem";
const ACTIONS_TRACK = "minmax(2.25rem,auto)";

/** Name that keeps its end visible when cut short. */
export function MiddleName({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const { head, tail } = splitName(name);
  return (
    <span className={cn("flex min-w-0", className)} title={name}>
      {/* Screen readers get the whole name once, not two halves. */}
      <span className="sr-only">{name}</span>
      <span aria-hidden className="truncate">
        {head}
      </span>
      {tail ? (
        <span aria-hidden className="shrink-0 whitespace-pre">
          {tail}
        </span>
      ) : null}
    </span>
  );
}

export function ItemIcon({
  item,
  className,
}: {
  item: Pick<FileListItem, "kind" | "mimeType" | "icon">;
  className?: string;
}) {
  return (
    <ItemTypeIcon
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center",
        className,
      )}
      icon={item.icon}
      size={18}
      tone="plain"
      visual={getItemVisual(item.kind, item.mimeType)}
    />
  );
}

/**
 * The thumbnail, or the type icon while there is none: thumbnails are made
 * after upload, so the first view can miss.
 */
export function ItemPreview({
  item,
  className,
  iconClassName = "size-10 [&_svg]:size-8",
  fit = "cover",
}: {
  item: Pick<FileListItem, "kind" | "mimeType" | "icon" | "thumbnailUrl">;
  className?: string;
  iconClassName?: string;
  fit?: "cover" | "contain";
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url =
    item.thumbnailUrl && item.thumbnailUrl !== failedUrl
      ? item.thumbnailUrl
      : null;
  return (
    <span
      className={cn(
        "relative flex aspect-4/3 items-center justify-center overflow-hidden rounded-lg bg-muted",
        className,
      )}
    >
      {url ? (
        <img
          alt=""
          className={cn(
            "size-full",
            fit === "cover" ? "object-cover" : "object-contain",
          )}
          decoding="async"
          draggable={false}
          loading="lazy"
          src={url}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <ItemIcon className={iconClassName} item={item} />
      )}
    </span>
  );
}

function CheckMark({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 items-center justify-center rounded-sm border border-input bg-card text-primary-foreground opacity-0 transition-opacity duration-100 group-hover/item:opacity-100",
        selected && "border-primary bg-primary opacity-100",
      )}
      data-check
    >
      {selected ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

function MoreActions({
  groups,
  name,
  onOpenSheet,
  coarse,
}: {
  groups: DashboardContextMenuGroup[];
  name: string;
  onOpenSheet: () => void;
  coarse: boolean;
}) {
  if (coarse) {
    return (
      <Button
        aria-label={`Actions for ${name}`}
        size="icon-sm"
        variant="ghost-muted"
        onClick={(event) => {
          event.stopPropagation();
          onOpenSheet();
        }}
      >
        <MoreHorizontal aria-hidden />
      </Button>
    );
  }
  return (
    <Menu>
      <MenuTrigger
        aria-label={`Actions for ${name}`}
        render={<Button size="icon-sm" variant="ghost-muted" />}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal aria-hidden />
      </MenuTrigger>
      <MenuPopup align="end" className="min-w-56">
        <DashboardMenuItems groups={groups} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The one file list: rows or cards, selection, keyboard, right-click and
 * touch actions. Pages decide the columns and the actions.
 */
export function FileList<T extends FileListItem>({
  label,
  items,
  groups,
  columns,
  view = "list",
  selection,
  coarse,
  getActions,
  quickActions,
  renderName,
  itemProps,
  itemClassName,
  sort,
  empty,
  children,
  className,
}: FileListProps<T>) {
  const [sheetItem, setSheetItem] = useState<T | null>(null);
  const sections = groups ?? [{ label: "", items }];
  const isEmpty = sections.every((section) => section.items.length === 0);

  const tracks = (visible: FileListColumn<T>[]) =>
    [
      CHECK_TRACK,
      "minmax(0,1fr)",
      ...visible.map((c) => c.width),
      ACTIONS_TRACK,
    ].join(" ");
  const style = {
    "--cols-sm": [CHECK_TRACK, "minmax(0,1fr)", ACTIONS_TRACK].join(" "),
    "--cols-md": tracks(columns.filter((c) => c.priority !== "wide")),
    "--cols-lg": tracks(columns),
  } as CSSProperties;
  const gridCols =
    "grid grid-cols-(--cols-sm) items-center gap-x-3 @xl/list:grid-cols-(--cols-md) @4xl/list:grid-cols-(--cols-lg)";
  const columnCell = (column: FileListColumn<T>) =>
    cn(
      "hidden truncate text-meta text-muted-foreground tabular-nums",
      column.priority === "wide" ? "@4xl/list:block" : "@xl/list:block",
      column.align === "end" && "text-right",
    );

  const renderItem = (item: T) => {
    const selected = selection.selected.has(item.id);
    const disabled = Boolean(item.blocked);
    const actions = disabled ? [] : (getActions?.(item) ?? []);
    const base = selection.itemProps(item.id, { disabled });
    const extra = disabled ? {} : (itemProps?.(item) ?? {});
    const name = renderName?.(item) ?? (
      <MiddleName className="font-medium" name={item.name} />
    );
    const moreActions =
      actions.length > 0 ? (
        <MoreActions
          coarse={coarse}
          groups={actions}
          name={item.name}
          onOpenSheet={() => setSheetItem(item)}
        />
      ) : null;

    const body =
      view === "grid" ? (
        <div
          {...extra}
          {...base}
          className={cn(
            "group/item relative grid min-w-0 cursor-default gap-1.5 rounded-xl border border-transparent p-1.5 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
            !selected && "hover:bg-hover",
            selected && "border-primary/45 bg-primary/9",
            item.dimmed && "opacity-50",
            disabled && "opacity-60",
            itemClassName?.(item),
          )}
          role="row"
        >
          <div className="contents" role="gridcell">
            <ItemPreview item={item} />
            <span className="absolute top-3 left-3">
              <CheckMark selected={selected} />
            </span>
            {moreActions ? (
              <span
                className={cn(
                  "absolute top-2.5 right-2.5 rounded-md bg-card/90 opacity-0 shadow-raised group-hover/item:opacity-100 focus-within:opacity-100",
                  (coarse || selected) && "opacity-100",
                )}
              >
                {moreActions}
              </span>
            ) : null}
            <span className="flex min-w-0 items-center gap-2 px-1 pb-0.5 text-body">
              <ItemIcon className="size-4 [&_svg]:size-4" item={item} />
              <span className="min-w-0 flex-1">{name}</span>
              {item.flags}
            </span>
            {item.blocked || item.sub ? (
              <span className="truncate px-1 text-label text-muted-foreground">
                {item.blocked ?? item.sub}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          {...extra}
          {...base}
          className={cn(
            gridCols,
            "group/item relative min-h-11 cursor-default rounded-lg px-1.5 py-1 text-body outline-none select-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-14",
            !selected && "hover:bg-hover",
            selected && "bg-selected",
            item.dimmed && "opacity-50",
            disabled && "opacity-60",
            itemClassName?.(item),
          )}
          role="row"
        >
          <span className="flex justify-center" role="gridcell">
            {coarse ? null : <CheckMark selected={selected} />}
          </span>
          <span className="flex min-w-0 items-center gap-2.5" role="gridcell">
            <ItemIcon item={item} />
            <span className="grid min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0">{name}</span>
                {item.flags}
              </span>
              {item.blocked ? (
                <span className="truncate text-label text-muted-foreground">
                  {item.blocked}
                </span>
              ) : item.sub ? (
                <span className="truncate text-label text-muted-foreground @xl/list:hidden">
                  {item.sub}
                </span>
              ) : null}
            </span>
          </span>
          {columns.map((column) => (
            <span
              className={columnCell(column)}
              key={column.key}
              role="gridcell"
            >
              {column.render(item)}
            </span>
          ))}
          <span
            className={cn(
              "flex items-center justify-end gap-0.5",
              !coarse &&
                "opacity-0 group-hover/item:opacity-100 group-aria-selected/item:opacity-100 focus-within:opacity-100",
            )}
            role="gridcell"
          >
            {coarse ? null : quickActions?.(item)}
            {moreActions}
          </span>
        </div>
      );

    return actions.length > 0 ? (
      <DashboardItemContextMenu groups={actions} key={item.id}>
        {body}
      </DashboardItemContextMenu>
    ) : (
      <Fragment key={item.id}>{body}</Fragment>
    );
  };

  return (
    <div
      className={cn("@container/list relative min-w-0", className)}
      style={style}
    >
      <div
        {...selection.listProps}
        aria-label={label}
        aria-multiselectable
        data-file-list
        className="relative min-h-40 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        role="grid"
      >
        {view === "list" && !isEmpty ? (
          <div
            className={cn(
              gridCols,
              "sticky top-0 z-10 hidden h-9 border-b border-border bg-card px-1.5 text-label font-medium text-muted-foreground @xl/list:grid",
            )}
            data-list-head
            role="row"
          >
            <span role="columnheader" />
            <SortHead label="Name" sortKey="name" sort={sort} />
            {columns.map((column) =>
              column.sortable && sort ? (
                <SortHead
                  align={column.align}
                  className={columnCell(column)}
                  key={column.key}
                  label={column.label}
                  sort={sort}
                  sortKey={column.key}
                />
              ) : (
                <span
                  className={cn(columnCell(column), "text-label font-medium")}
                  key={column.key}
                  role="columnheader"
                >
                  {column.label}
                </span>
              ),
            )}
            <span role="columnheader">
              <span className="sr-only">Actions</span>
            </span>
          </div>
        ) : null}

        {isEmpty ? empty : null}

        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div className="grid" key={section.label} role="rowgroup">
              {section.label ? (
                <div
                  className="px-1.5 pt-4 pb-1.5 text-meta font-semibold"
                  role="row"
                >
                  <span role="columnheader">{section.label}</span>
                </div>
              ) : null}
              <div
                className={
                  view === "grid"
                    ? "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 pt-2"
                    : "grid gap-px pt-1"
                }
              >
                {section.items.map(renderItem)}
              </div>
            </div>
          ),
        )}
        {children}
        {selection.rubberBand ? (
          <div
            aria-hidden
            className="pointer-events-none absolute z-20 rounded-xs border border-primary/45 bg-primary/8"
            style={{
              left: Math.min(
                selection.rubberBand.startX,
                selection.rubberBand.currentX,
              ),
              top: Math.min(
                selection.rubberBand.startY,
                selection.rubberBand.currentY,
              ),
              width: Math.abs(
                selection.rubberBand.currentX - selection.rubberBand.startX,
              ),
              height: Math.abs(
                selection.rubberBand.currentY - selection.rubberBand.startY,
              ),
            }}
          />
        ) : null}
      </div>
      <WorkspaceActionSheet
        groups={sheetItem ? (getActions?.(sheetItem) ?? []) : []}
        itemName={sheetItem?.name}
        open={sheetItem !== null}
        onOpenChange={(open) => {
          if (!open) setSheetItem(null);
        }}
      />
    </div>
  );
}

function SortHead({
  label,
  sortKey,
  sort,
  align,
  className,
}: {
  label: string;
  sortKey: string;
  sort?: FileListSort;
  align?: "end";
  className?: string;
}) {
  if (!sort) {
    return (
      <span className={className} role="columnheader">
        {label}
      </span>
    );
  }
  const active = sort.key === sortKey;
  const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <span
      aria-sort={
        active
          ? sort.direction === "asc"
            ? "ascending"
            : "descending"
          : "none"
      }
      className={cn(className, "flex", align === "end" && "justify-end")}
      role="columnheader"
    >
      <button
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 rounded-sm text-label font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
        )}
        type="button"
        onClick={() => sort.onSort(sortKey)}
      >
        {label}
        {active ? <Arrow aria-hidden className="size-3" /> : null}
      </button>
    </span>
  );
}

/** Signed-in thumbnail URL, for files that can have one. */
export const thumbnailUrlFor = (file: {
  id: string;
  kind: "file" | "folder";
  name: string;
  mimeType?: string | null;
}) =>
  file.kind === "file" && canHaveThumbnail(file.mimeType ?? "", file.name)
    ? `/api/files/files/${file.id}/thumbnail`
    : null;
