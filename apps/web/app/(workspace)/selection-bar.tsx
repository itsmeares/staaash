import { X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export type SelectionBarAction = {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

/** The look of bars that float over a list: selection, cut items. */
export const floatingBarClass =
  "fixed bottom-[calc(92px+env(safe-area-inset-bottom))] left-1/2 z-38 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 animate-in items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-selection-bar duration-260 ease-out fade-in slide-in-from-bottom-2 motion-reduce:animate-none sm:bottom-6 rail:left-[calc(50%+var(--spacing-rail)/2)] desk:left-[calc(50%+var(--spacing-sidebar)/2)]";

/** Floats over the list while items are selected. */
export function SelectionBar({
  count,
  actions,
  onClear,
}: {
  count: number;
  actions: SelectionBarAction[];
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div
      aria-label="Selection"
      className={floatingBarClass}
      data-slot="selection-bar"
      role="toolbar"
    >
      <Button
        aria-label="Clear selection"
        size="icon-sm"
        variant="ghost-muted"
        onClick={onClear}
      >
        <X aria-hidden />
      </Button>
      <span className="px-1.5 text-body font-semibold whitespace-nowrap tabular-nums">
        {count} selected
      </span>
      <span aria-hidden className="mx-1 h-5 w-px bg-border" />
      {actions.map(({ label, icon: Icon, onClick, destructive, disabled }) => (
        <Button
          aria-label={label}
          disabled={disabled}
          key={label}
          size="sm"
          variant={destructive ? "ghost-destructive" : "ghost"}
          onClick={onClick}
        >
          <Icon aria-hidden />
          <span className="max-sm:hidden">{label}</span>
        </Button>
      ))}
    </div>
  );
}
