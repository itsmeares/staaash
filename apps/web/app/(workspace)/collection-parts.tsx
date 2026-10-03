import { ArrowDown, ArrowUp } from "lucide-react";
import type * as React from "react";

import { ItemTypeIcon } from "@/app/item-type-icon";
import type { ItemVisual } from "@/app/item-visuals";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionLabel } from "@/components/section-label";
import { cn } from "@/lib/utils";

import {
  ROW_BASE,
  ROW_ICON,
  ROW_ICON_CELL,
  ROW_META,
  ROW_NAME,
} from "./files/files-row-styles";

// Column layout shared by the list header and rows of Recent and Favorites.
// Location and size drop out below 1024px, the time column below 720px.
const COLLECTION_GRID =
  "grid items-center grid-cols-[28px_minmax(0,1fr)_minmax(78px,96px)] gap-x-2.5 lg:grid-cols-[36px_minmax(225px,1fr)_minmax(175px,225px)_minmax(90px,104px)_minmax(108px,138px)] lg:gap-x-3.5 max-md:grid-cols-[32px_minmax(0,1fr)_44px] pointer-coarse:grid-cols-[32px_minmax(0,1fr)_44px]";

const ACTIONS_BOX =
  "inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-xs [&_form]:inline-flex";

export const COLLECTION_ROW_ICON_CELL = ROW_ICON_CELL;
export const COLLECTION_ROW_NAME = cn(ROW_NAME, "flex items-center gap-1.5");
export const COLLECTION_ROW_LOCATION = cn(
  ROW_META,
  "px-2 text-left max-lg:hidden",
);
export const COLLECTION_ROW_SIZE = cn(
  ROW_META,
  "px-1 font-mono tabular-nums max-lg:hidden",
);
export const COLLECTION_ROW_TIME = cn(ROW_META, "px-1 tabular-nums");

export function CollectionToolbar({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 max-md:flex-wrap max-md:items-stretch pointer-coarse:flex-wrap pointer-coarse:items-stretch",
        className,
      )}
      data-collection-toolbar
      {...props}
    />
  );
}

export function TypeFilterSelect({
  options,
  value,
  onValueChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const items = options.map((option) => ({
    label: option.label,
    value: option.id,
  }));
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next);
      }}
    >
      <SelectTrigger
        aria-label="Type"
        className="w-auto min-w-40 max-md:flex-1 pointer-coarse:flex-1"
        size="sm"
      >
        <SectionLabel className="text-xs">Type</SectionLabel>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export function CollectionEmpty({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Empty className="min-h-80">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function CollectionColumnHead({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        COLLECTION_GRID,
        "sticky top-0 z-2 min-h-10 border-b pt-0.5 pr-2 pb-2 pl-1 max-md:hidden lg:min-h-12 lg:pt-1.5 lg:pr-3 lg:pb-3 lg:pl-2 pointer-coarse:hidden",
        className,
      )}
      data-collection-head
      role="row"
      {...props}
    />
  );
}

export function CollectionSortButton({
  column,
  label,
  active,
  direction,
  align = "left",
  className,
  onClick,
}: {
  column: string;
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  align?: "left" | "right";
  className?: string;
  onClick: () => void;
}) {
  const Arrow = active && direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      className={cn(
        "flex min-w-0 items-center gap-1 px-1 text-xs font-medium tracking-wider whitespace-nowrap text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:text-foreground lg:text-label",
        align === "right" && "justify-end",
        active && "text-foreground",
        className,
      )}
      data-align={align}
      data-column={column}
      type="button"
      onClick={onClick}
    >
      {label}
      <Arrow size={11} aria-hidden />
    </button>
  );
}

export function CollectionRow({
  selected,
  deleted = false,
  className,
  ...props
}: React.ComponentProps<"article"> & {
  selected: boolean;
  deleted?: boolean;
}) {
  return (
    <article
      className={cn(
        COLLECTION_GRID,
        ROW_BASE,
        "group/row rounded-none border-b border-hairline focus-within:bg-hover",
        selected &&
          "bg-selected focus-within:bg-primary/14 hover:bg-primary/14",
        deleted &&
          "bg-hover/40 text-muted-foreground focus-within:bg-hover/60 hover:bg-hover/60",
        className,
      )}
      {...props}
    />
  );
}

export function RowIcon({
  visual,
  deleted = false,
}: {
  visual: ItemVisual;
  deleted?: boolean;
}) {
  return (
    <span className={cn(ROW_ICON_CELL, deleted && "opacity-50")}>
      <ItemTypeIcon className={ROW_ICON} tone="plain" visual={visual} />
    </span>
  );
}

export function FavoriteDot() {
  return (
    <span
      aria-label="Favorited"
      className="size-1.5 shrink-0 rounded-full bg-primary opacity-75"
    />
  );
}

export function DeletedBadge() {
  return (
    <Badge size="sm" variant="neutral">
      Deleted
    </Badge>
  );
}

/** Floating action box on the right of a row, revealed on hover or focus. */
export function RowActions({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        ACTIONS_BOX,
        "pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 opacity-0 transition-opacity duration-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100 motion-reduce:transition-none max-lg:pointer-events-auto max-lg:opacity-100 max-md:static max-md:col-start-3 max-md:translate-y-0 max-md:justify-self-end max-md:shadow-none pointer-coarse:pointer-events-auto pointer-coarse:static pointer-coarse:col-start-3 pointer-coarse:translate-y-0 pointer-coarse:justify-self-end pointer-coarse:opacity-100 pointer-coarse:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

/** Action box that sits inside a cell (deleted rows keep it in the time column). */
export function InlineActions({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span className={cn(ACTIONS_BOX, "justify-end", className)} {...props} />
  );
}

export function RowActionButton({
  tone = "default",
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & {
  tone?: "default" | "danger" | "pinned";
}) {
  return (
    <button
      className={cn(
        "inline-flex size-6.5 items-center justify-center rounded-xs text-muted-foreground transition-colors outline-none hover:bg-pressed hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 motion-reduce:transition-none max-md:size-9.5 lg:size-10.5 pointer-coarse:size-9.5",
        tone === "danger" && "hover:bg-destructive/10 hover:text-destructive",
        tone === "pinned" && "text-primary-ink hover:bg-primary/10",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export const COLLECTION_GRID_CARDS =
  "grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-2.5 max-md:grid-cols-[repeat(auto-fill,minmax(148px,1fr))] pointer-coarse:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]";

export function CollectionGridCard({
  selected,
  deleted = false,
  className,
  ...props
}: React.ComponentProps<"article"> & {
  selected: boolean;
  deleted?: boolean;
}) {
  return (
    <article
      className={cn(
        "group/card relative cursor-default overflow-hidden rounded-lg border bg-hover transition-colors duration-100 outline-none hover:border-line-strong hover:bg-pressed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring/60 motion-reduce:transition-none",
        selected &&
          "border-primary/30 bg-selected hover:border-primary/30 hover:bg-selected",
        deleted &&
          "border-hairline bg-hover/40 hover:border-line-strong hover:bg-hover/60",
        className,
      )}
      {...props}
    />
  );
}

export function GridCardPreview({
  visual,
  deleted = false,
  children,
}: {
  visual: ItemVisual;
  deleted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className="relative flex h-23 items-center justify-center border-b"
      style={{ background: visual.background }}
    >
      <ItemTypeIcon
        className={cn(
          "inline-flex size-12 items-center justify-center",
          deleted && "opacity-50",
        )}
        size={30}
        tone="plain"
        visual={visual}
      />
      {children}
    </div>
  );
}

export function GridCardBody({
  name,
  deleted = false,
  badge,
  start,
  end,
}: {
  name: string;
  deleted?: boolean;
  badge?: React.ReactNode;
  start: React.ReactNode;
  end: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 px-2.5 py-2">
      <span
        className={cn(
          "truncate text-label leading-snug font-semibold text-foreground lg:text-sm",
          deleted && "text-muted-foreground",
        )}
        title={name}
      >
        {name}
      </span>
      {badge}
      <span className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{start}</span>
        <span>{end}</span>
      </span>
    </div>
  );
}

export function GridCardActions({
  placement,
  alwaysVisible = false,
  ...props
}: React.ComponentProps<"span"> & {
  placement: "top" | "bottom";
  alwaysVisible?: boolean;
}) {
  return (
    <span
      className={cn(
        ACTIONS_BOX,
        "pointer-events-none absolute right-2 opacity-0 transition-opacity duration-100 group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100 group-hover/card:pointer-events-auto group-hover/card:opacity-100 motion-reduce:transition-none max-lg:pointer-events-auto max-lg:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100",
        placement === "top" ? "top-1.75" : "bottom-2",
        alwaysVisible && "pointer-events-auto opacity-100",
      )}
      {...props}
    />
  );
}
