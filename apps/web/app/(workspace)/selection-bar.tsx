import { Button } from "@/components/ui/button";

export type SelectionBarAction = {
  label: string;
  onClick: () => void;
  destructive?: boolean;
};

/** Floating action bar for touch layouts; hidden from 1024px up. */
export function SelectionBar({
  count,
  actions,
}: {
  count: number;
  actions: SelectionBarAction[];
}) {
  return (
    <div
      className="fixed right-2.5 bottom-[calc(72px+env(safe-area-inset-bottom))] left-2.5 z-38 flex min-h-13 items-center gap-1.5 rounded-xl border bg-card p-1.75 shadow-selection-bar lg:hidden md:max-lg:landscape:bottom-3.5 md:max-lg:landscape:left-21.5"
      data-slot="selection-bar"
      role="region"
    >
      <span className="min-w-0 flex-1 pl-2 text-xs font-semibold text-muted-foreground">
        {count} item{count === 1 ? "" : "s"}
      </span>
      {actions.map((action) => (
        <Button
          key={action.label}
          size="xs"
          variant={action.destructive ? "destructive" : "secondary"}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
