"use client";

import { ArrowDown, ArrowUp, Check, MoreHorizontal, Play } from "lucide-react";
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
import { folderColorStyle } from "@/lib/folder-color";
import { getItemVisual } from "@/app/item-visuals";
import { WorkspaceActionSheet } from "./action-sheet";
import { MiddleName } from "./middle-name";
import { Button } from "@/components/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { canHaveThumbnail } from "@staaash/db/viewer-contract";
import { cn } from "@/lib/utils";

import type { ListSelection } from "./use-list-selection";

export type FileListItem = {
  id: string;
  kind: "folder" | "file";
  name: string;
  mimeType?: string | null;
  /** A custom folder icon. */
  icon?: LucideIcon;
  /** A folder color: a swatch name or a custom "#rrggbb". */
  color?: string | null;
  /** Thumbnails of photos inside a folder, peeking out of its card. */
  previewUrls?: string[];
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

type FileListSort = {
  key: string;
  direction: "asc" | "desc";
  onSort: (key: string) => void;
};

type FileListGroup<T> = { label: string; items: T[] };

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
  /** Column titles above the rows. Without them the second line always shows. */
  head?: boolean;
  /** Grid cards as square tiles: photos and videos without a caption. */
  tiles?: boolean;
  empty?: ReactNode;
  /** Rendered after the items, inside the list. */
  children?: ReactNode;
  /** Rendered before the first item, in the list's own layout (new folder). */
  leading?: ReactNode;
  className?: string;
};

// Fixed, because each row is its own grid: an auto track would size per row
// and pull the cells away from the header. Room for More and one icon button.
const actionsTrack = (quick: boolean) => (quick ? "4.25rem" : "2.25rem");

export function ItemIcon({
  item,
  className,
}: {
  item: Pick<FileListItem, "kind" | "mimeType" | "icon" | "color">;
  className?: string;
}) {
  const tint = item.kind === "folder" ? folderColorStyle(item.color) : null;
  if (tint) {
    return (
      <span
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-sm",
          className,
        )}
        style={{ background: tint.tile }}
      >
        <ItemTypeIcon
          className="inline-flex"
          color={tint.color}
          icon={item.icon}
          size={18}
          tone="plain"
          visual={getItemVisual(item.kind, item.mimeType)}
        />
      </span>
    );
  }
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
/** Up to two photos tucked into a folder shape, for grid folder cards. */
function FolderPeek({
  urls,
  color,
  className,
}: {
  urls: string[];
  color: string | null;
  className?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const shown = urls.filter((url) => !failed.includes(url));
  const photo =
    "absolute top-[12%] aspect-4/3 w-[44%] rounded-md object-cover shadow-[0_2px_6px_rgb(0_0_0/0.3)]";
  return (
    <span
      className={cn(
        "relative flex aspect-4/3 overflow-hidden rounded-lg bg-muted",
        className,
      )}
      style={
        color
          ? { background: `color-mix(in oklab, ${color} 12%, transparent)` }
          : undefined
      }
    >
      {shown.slice(0, 2).map((url, index) => (
        <img
          alt=""
          className={cn(
            photo,
            index === 0 ? "left-[36%] rotate-6" : "left-[20%] -rotate-8",
          )}
          decoding="async"
          draggable={false}
          key={url}
          loading="lazy"
          src={url}
          style={{ zIndex: 2 - index }}
          onError={() => setFailed((list) => [...list, url])}
        />
      ))}
      <svg
        aria-hidden
        className="absolute bottom-[6%] left-[12%] z-3 h-[56%] w-[76%]"
        preserveAspectRatio="none"
        viewBox="0 0 100 60"
      >
        <path
          d="M0 8a6 6 0 0 1 6-6h24l6 6h58a6 6 0 0 1 6 6v40a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6z"
          fill={
            color
              ? `color-mix(in oklab, ${color} 38%, var(--card))`
              : "color-mix(in oklab, var(--foreground) 14%, var(--card))"
          }
        />
      </svg>
    </span>
  );
}

type PreviewItem = Pick<
  FileListItem,
  "kind" | "mimeType" | "icon" | "thumbnailUrl" | "color" | "previewUrls"
>;

const tintOf = (item: PreviewItem) =>
  item.kind === "folder" ? (folderColorStyle(item.color)?.color ?? null) : null;

export function ItemPreview({
  item,
  className,
  iconClassName = "size-10 [&_svg]:size-8",
  fit = "cover",
}: {
  item: PreviewItem;
  className?: string;
  iconClassName?: string;
  fit?: "cover" | "contain";
}) {
  const tint = tintOf(item);
  const peek = item.kind === "folder" ? (item.previewUrls ?? []) : [];
  if (peek.length > 0) {
    return <FolderPeek className={className} color={tint} urls={peek} />;
  }
  return (
    <PreviewTile
      className={className}
      fit={fit}
      iconClassName={iconClassName}
      item={item}
      tint={tint}
    />
  );
}

/** The thumbnail when there is one, the icon when it's missing or broken. */
function PreviewTile({
  item,
  tint,
  className,
  iconClassName,
  fit,
}: {
  item: PreviewItem;
  tint: string | null;
  className?: string;
  iconClassName: string;
  fit: "cover" | "contain";
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
      style={
        tint
          ? { background: `color-mix(in oklab, ${tint} 16%, transparent)` }
          : undefined
      }
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
          ref={(img) => {
            // A server-rendered image can fail before React listens for
            // errors; catch that on mount.
            if (img?.complete && img.naturalWidth === 0) setFailedUrl(url);
          }}
          src={url}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <ItemIcon className={iconClassName} item={item} />
      )}
    </span>
  );
}

/** A row's thumbnail, or its type icon (on a tile on phones). */
function RowLead({
  item,
  className,
}: {
  item: PreviewItem;
  className?: string;
}) {
  if (!item.thumbnailUrl) {
    return (
      <span
        className={cn(
          "grid size-full place-items-center rounded-lg max-sm:bg-hover",
          className,
        )}
      >
        <ItemIcon item={item} />
      </span>
    );
  }
  return (
    <span className={cn("relative block size-full", className)}>
      <ItemPreview
        className="aspect-square size-full rounded-md inset-ring inset-ring-foreground/8 max-sm:rounded-lg"
        iconClassName="size-5"
        item={item}
      />
      {item.mimeType?.startsWith("video/") ? (
        <span className="absolute right-0.5 bottom-0.5 grid size-3 place-items-center rounded-xs bg-black/55 text-white">
          <Play aria-hidden className="size-2 fill-current" />
        </span>
      ) : null}
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
// The list shell: head, sections, empty state, rubber band and phone sheet.
// fallow-ignore-next-line complexity
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
  head = true,
  tiles = false,
  empty,
  children,
  leading,
  className,
}: FileListProps<T>) {
  const [sheetItem, setSheetItem] = useState<T | null>(null);
  const sections = groups ?? [{ label: "", items }];
  const isEmpty = sections.every((section) => section.items.length === 0);

  const actions = actionsTrack(Boolean(quickActions));
  const tracks = (visible: FileListColumn<T>[], name = "minmax(0,1fr)") =>
    [name, ...visible.map((c) => c.width), actions].join(" ");
  const style = {
    "--cols-sm": ["minmax(0,1fr)", actions].join(" "),
    "--cols-md": tracks(columns.filter((c) => c.priority !== "wide")),
    // On very wide screens the name stops growing, so size and date stay
    // next to it.
    "--cols-lg": tracks(columns, "minmax(0,56rem)"),
  } as CSSProperties;
  const sectionClass = {
    list: "grid gap-px pt-1",
    grid: "grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-2 pt-2",
    tiles: "grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 pt-2",
  }[view === "grid" && tiles ? "tiles" : view];
  const gridCols =
    "grid grid-cols-(--cols-sm) items-center gap-x-3 @xl/list:grid-cols-(--cols-md) @4xl/list:grid-cols-(--cols-lg)";
  const columnCell = (column: FileListColumn<T>) =>
    cn(
      "hidden truncate text-meta text-muted-foreground tabular-nums",
      column.priority === "wide" ? "@4xl/list:block" : "@xl/list:block",
      column.align === "end" && "text-right",
    );

  // One row renderer for list and grid, with every optional part a page can pass.
  // fallow-ignore-next-line complexity
  const renderItem = (item: T) => {
    const selected = selection.selected.has(item.id);
    const disabled = Boolean(item.blocked);
    const actions = disabled ? [] : (getActions?.(item) ?? []);
    const base = selection.itemProps(item.id, { disabled });
    const extra = disabled ? {} : (itemProps?.(item) ?? {});
    // Touch grid cards wrap long names onto a second line before cutting.
    const name =
      renderName?.(item) ??
      (coarse && view === "grid" ? (
        <span className="line-clamp-2 font-medium wrap-anywhere">
          {item.name}
        </span>
      ) : (
        <MiddleName className="font-medium" name={item.name} />
      ));
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
            <ItemPreview
              className={tiles ? "aspect-square" : undefined}
              item={item}
            />
            <span className="absolute top-3 left-3">
              <CheckMark selected={selected} />
            </span>
            {/* Touch cards have no "…": press and hold selects, and the
                selection offers the actions. */}
            {moreActions && !coarse ? (
              <span
                className={cn(
                  "absolute top-2.5 right-2.5 rounded-md bg-card/90 opacity-0 shadow-raised group-hover/item:opacity-100 focus-within:opacity-100",
                  selected && "opacity-100",
                )}
              >
                {moreActions}
              </span>
            ) : null}
            {/* Timeline tiles show photos bare; the name is in the tooltip. */}
            {tiles && item.thumbnailUrl ? (
              <span className="sr-only">{item.name}</span>
            ) : (
              <span className="flex min-w-0 items-start gap-2 px-1 pb-0.5 text-body">
                <ItemIcon
                  className="mt-0.5 size-4 [&_svg]:size-4"
                  item={item}
                />
                <span className="min-w-0 flex-1">{name}</span>
                {item.flags}
              </span>
            )}
            {(item.blocked || item.sub) && !tiles ? (
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
          <span className="flex min-w-0 items-center gap-2.5" role="gridcell">
            {/* The checkbox takes the icon's place on hover or when selected,
                so no column is kept empty for it. Touch selects by long press. */}
            <span className="relative grid size-7 shrink-0 place-items-center max-sm:size-10">
              <RowLead
                className={cn(
                  !coarse && "group-hover/item:opacity-0",
                  selected && !coarse && "opacity-0",
                )}
                item={item}
              />
              {coarse ? null : (
                <span className="absolute inset-0 grid place-items-center">
                  <CheckMark selected={selected} />
                </span>
              )}
            </span>
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
                <span
                  className={cn(
                    "truncate text-label text-muted-foreground",
                    head && columns.length > 0 && "@xl/list:hidden",
                  )}
                >
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
        {view === "list" && head && !isEmpty && columns.length > 0 ? (
          <div
            className={cn(
              gridCols,
              "sticky top-0 z-10 hidden h-9 border-b border-border bg-card px-1.5 text-label font-medium text-muted-foreground @xl/list:grid",
            )}
            data-list-head
            role="row"
          >
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

        {isEmpty && !leading ? empty : null}

        {(isEmpty && leading
          ? [{ label: "", items: [] as T[] }]
          : sections
        ).map((section, index) =>
          section.items.length === 0 && !(leading && index === 0) ? null : (
            <div className="grid" key={section.label} role="rowgroup">
              {section.label ? (
                <div
                  className="px-1.5 pt-4 pb-1.5 text-meta font-semibold"
                  role="row"
                >
                  <span role="columnheader">{section.label}</span>
                </div>
              ) : null}
              <div className={sectionClass}>
                {index === 0 ? leading : null}
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

// Header cells show sort state, direction and alignment.
// fallow-ignore-next-line complexity
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

/** The name with the matched part marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const at = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-xs bg-primary/20 text-foreground">
        {text.slice(at, at + query.length)}
      </mark>
      {text.slice(at + query.length)}
    </>
  );
}
