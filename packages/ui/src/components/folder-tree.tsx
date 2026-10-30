import { ChevronRight, Search } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "../utils";
import { Input } from "./input";

// Indent per level, in px.
const INDENT = 22;

function Guides({ depth }: { depth: number }) {
  return Array.from({ length: depth }, (_, level) => (
    <span
      aria-hidden
      className="absolute inset-y-0 w-px bg-foreground/10"
      key={level}
      style={{ left: 16 + level * INDENT }}
    />
  ));
}

/** The arrow: turns when open, and folds or opens alone. */
function Caret({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  return (
    <span
      className="grid size-5 shrink-0 place-items-center text-muted-foreground"
      onClick={(event) => {
        if (!onToggle) return;
        event.stopPropagation();
        onToggle();
      }}
    >
      {onToggle ? (
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 transition-transform duration-270 ease-slide motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
      ) : null}
    </span>
  );
}

export function FolderTreeRow({
  depth,
  label,
  icon,
  note,
  trailing,
  open = false,
  picked,
  disabled,
  onPick,
  onToggle,
}: {
  depth: number;
  label: ReactNode;
  icon: ReactNode;
  note?: string;
  trailing?: ReactNode;
  open?: boolean;
  picked: boolean;
  disabled: boolean;
  onPick: () => void;
  onToggle?: () => void;
}): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (picked) ref.current?.scrollIntoView({ block: "nearest" });
  }, [picked]);
  const pick = () => !disabled && onPick();
  return (
    <div
      aria-disabled={disabled || undefined}
      aria-expanded={onToggle ? open : undefined}
      aria-level={depth + 1}
      aria-selected={picked}
      className={cn(
        "relative flex h-9 cursor-pointer items-center gap-1.5 rounded-lg pe-2 text-body outline-none select-none hover:bg-hover aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-selected:selected-pill",
      )}
      ref={ref}
      role="treeitem"
      style={{ paddingInlineStart: 8 + depth * INDENT }}
      tabIndex={picked ? 0 : -1}
      onClick={pick}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        pick();
      }}
    >
      <Guides depth={depth} />
      <Caret open={open} onToggle={onToggle} />
      {icon}
      <span className="min-w-0 truncate">{label}</span>
      {note ? (
        <span className="ms-auto shrink-0 ps-2 text-label text-muted-foreground italic">
          {note}
        </span>
      ) : null}
      {trailing ? (
        <span className={cn("shrink-0 ps-2", !note && "ms-auto")}>
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

export function FolderFindInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/24">
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="sr-only">Find a folder</span>
      <input
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-body text-foreground outline-none placeholder:text-muted-foreground"
        placeholder="Find a folder"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/** A tree row whose name is being typed. Enter submits, Escape backs out. */
export function FolderNameRow({
  depth,
  icon,
  value,
  disabled,
  onChange,
  onSubmit,
  onCancel,
}: {
  depth: number;
  icon: ReactNode;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): ReactNode {
  return (
    <div
      className="flex h-9 items-center gap-1.5 pe-2"
      style={{ paddingInlineStart: 8 + depth * INDENT + 26 }}
    >
      {icon}
      <Input
        autoFocus
        aria-label="New folder name"
        disabled={disabled}
        size="sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
    </div>
  );
}
