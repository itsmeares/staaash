import { X, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";

export type SelectionBarAction = {
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** Opens a menu of choices instead, such as move targets. */
  menu?: Array<{ label: string; onClick: () => void }>;
  destructive?: boolean;
  disabled?: boolean;
};

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
      className="fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-1/2 z-38 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 animate-in items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-selection-bar duration-260 ease-out fade-in slide-in-from-bottom-2 motion-reduce:animate-none lg:bottom-6 lg:left-[calc(50%+var(--spacing-sidebar)/2)]"
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
        ({ label, icon: Icon, onClick, menu, destructive, disabled }) => {
          const content = (
            <>
              <Icon aria-hidden />
              <span className="max-sm:hidden">{label}</span>
            </>
          );
          const variant = destructive ? "ghost-destructive" : "ghost";
          return menu ? (
            <Menu key={label}>
              <MenuTrigger
                aria-label={label}
                disabled={disabled || menu.length === 0}
                render={<Button size="sm" variant={variant} />}
              >
                {content}
              </MenuTrigger>
              <MenuPopup
                align="center"
                side="top"
                className="max-h-80 min-w-56 overflow-y-auto"
              >
                {menu.map((choice) => (
                  <MenuItem key={choice.label} onClick={choice.onClick}>
                    {choice.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : (
            <Button
              aria-label={label}
              disabled={disabled}
              key={label}
              size="sm"
              variant={variant}
              onClick={onClick}
            >
              {content}
            </Button>
          );
        },
      )}
    </div>
  );
}
