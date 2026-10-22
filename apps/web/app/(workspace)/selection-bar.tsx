import { MoreHorizontal, X, type LucideIcon } from "lucide-react";

import { Button } from "@staaash/ui/components/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@staaash/ui/components/menu";
import { cn } from "@staaash/ui/utils";

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

const tabClass =
  "flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1 text-tab text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50 [&_svg]:size-5";

/**
 * Phones: while items are selected the top bar says how many, and the tabs
 * turn into the actions. A fifth and later action go under More.
 */
function PhoneSelection({
  count,
  actions,
  onClear,
  onSelectAll,
}: {
  count: number;
  actions: SelectionBarAction[];
  onClear: () => void;
  onSelectAll?: () => void;
}) {
  const shown = actions.length > 5 ? actions.slice(0, 4) : actions;
  const more = actions.slice(shown.length);
  return (
    <div className="sm:hidden" data-slot="phone-selection">
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-border bg-background px-3">
        <Button
          aria-label="Clear selection"
          size="icon"
          variant="ghost-muted"
          onClick={onClear}
        >
          <X aria-hidden />
        </Button>
        <span className="text-body font-semibold tabular-nums">
          {count} selected
        </span>
        {onSelectAll ? (
          <Button className="ms-auto" variant="ghost" onClick={onSelectAll}>
            Select all
          </Button>
        ) : null}
      </div>
      <div
        aria-label="Selection"
        className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(4.125rem+env(safe-area-inset-bottom))] auto-cols-fr grid-flow-col border-t border-border bg-background pb-[max(6px,env(safe-area-inset-bottom))]"
        role="toolbar"
      >
        {shown.map(({ label, icon: Icon, onClick, destructive, disabled }) => (
          <button
            className={cn(
              tabClass,
              destructive && "text-destructive-foreground",
            )}
            disabled={disabled}
            key={label}
            type="button"
            onClick={onClick}
          >
            <Icon aria-hidden strokeWidth={1.75} />
            {label}
          </button>
        ))}
        {more.length > 0 ? (
          <Menu>
            <MenuTrigger className={tabClass}>
              <MoreHorizontal aria-hidden strokeWidth={1.75} />
              More
            </MenuTrigger>
            <MenuPopup align="end" side="top">
              {more.map(({ label, icon: Icon, onClick, disabled }) => (
                <MenuItem disabled={disabled} key={label} onClick={onClick}>
                  <Icon aria-hidden />
                  {label}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
    </div>
  );
}

/** Floats over the list while items are selected; takes over the bars on phones. */
export function SelectionBar({
  count,
  actions,
  onClear,
  onSelectAll,
}: {
  count: number;
  actions: SelectionBarAction[];
  onClear: () => void;
  onSelectAll?: () => void;
}) {
  if (count === 0) return null;
  return (
    <>
      <PhoneSelection
        actions={actions}
        count={count}
        onClear={onClear}
        onSelectAll={onSelectAll}
      />
      <div
        aria-label="Selection"
        className={cn(floatingBarClass, "max-sm:hidden")}
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
        {actions.map(
          ({ label, icon: Icon, onClick, destructive, disabled }) => (
            <Button
              aria-label={label}
              disabled={disabled}
              key={label}
              size="sm"
              variant={destructive ? "ghost-destructive" : "ghost"}
              onClick={onClick}
            >
              <Icon aria-hidden />
              {label}
            </Button>
          ),
        )}
      </div>
    </>
  );
}
