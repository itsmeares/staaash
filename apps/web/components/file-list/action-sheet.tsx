"use client";

import { Fragment, type ReactNode } from "react";
import {
  Drawer,
  DrawerMenu,
  DrawerMenuGroup,
  DrawerMenuItem,
  DrawerMenuSeparator,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { MiddleName } from "./middle-name";
import { getVisibleDashboardMenuGroups } from "@/app/dashboard-context-menu-model";
import type {
  DashboardContextMenuAction,
  DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";

type WorkspaceActionSheetProps = {
  groups: DashboardContextMenuGroup[];
  item?: { name: string; sub?: ReactNode; preview: ReactNode } | null;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const iconSlot = "inline-flex w-4.5 justify-center text-muted-foreground";

/**
 * The phone's menu for an item: what it is on top, the four things people
 * do most as big buttons, then everything else as rows.
 */
export function WorkspaceActionSheet({
  groups,
  item,
  onOpenChange,
  open,
}: WorkspaceActionSheetProps) {
  const visibleGroups = getVisibleDashboardMenuGroups(groups);
  const quick = visibleGroups
    .flatMap((group) => group.actions)
    .filter((action) => action.quick);
  const rows = visibleGroups
    .map((group) => ({
      actions: group.actions.filter((action) => !action.quick),
    }))
    .filter((group) => group.actions.length > 0);

  const run = (action: DashboardContextMenuAction) => {
    if (action.disabled) return;
    action.onSelect?.();
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerPopup showBar>
        <DrawerTitle className="sr-only">Actions</DrawerTitle>
        <DrawerPanel className="grid gap-4 pb-6">
          {item ? (
            <div className="flex items-center gap-3">
              {item.preview}
              <div className="grid min-w-0">
                <MiddleName
                  className="text-body font-medium"
                  name={item.name}
                />
                {item.sub ? (
                  <span className="truncate text-label text-muted-foreground">
                    {item.sub}
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {quick.length > 0 ? (
            <div className="grid grid-cols-4 gap-2">
              {quick.map((action) => (
                <button
                  className={cn(
                    "grid cursor-pointer justify-items-center gap-1.5 rounded-xl bg-hover px-1 py-3 text-label outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-pressed disabled:opacity-60 [&_svg]:size-5",
                    action.destructive && "text-destructive-foreground",
                  )}
                  disabled={action.disabled}
                  key={action.label}
                  type="button"
                  onClick={() => run(action)}
                >
                  {action.icon}
                  {action.quick}
                </button>
              ))}
            </div>
          ) : null}

          <DrawerMenu>
            {rows.map((group, groupIndex) => (
              <DrawerMenuGroup key={groupIndex}>
                {groupIndex > 0 ? <DrawerMenuSeparator /> : null}
                {group.actions.map((action) => (
                  <Fragment key={action.label}>
                    {action.subActions && action.subActions.length > 0 ? (
                      <details className="grid">
                        <DrawerMenuItem
                          className={cn(
                            "list-none [&::-webkit-details-marker]:hidden",
                            action.disabled && "opacity-60",
                          )}
                          render={<summary />}
                        >
                          <span className={iconSlot}>{action.icon}</span>
                          <span>{action.label}</span>
                        </DrawerMenuItem>
                        <div className="grid gap-1 ps-10 pt-1.5 pb-0.5">
                          {action.subActions
                            .filter((subAction) => !subAction.hidden)
                            .map((subAction) => (
                              <DrawerMenuItem
                                disabled={subAction.disabled}
                                key={subAction.label}
                                onClick={() => run(subAction)}
                              >
                                <span className={iconSlot}>
                                  {subAction.icon}
                                </span>
                                {subAction.label}
                              </DrawerMenuItem>
                            ))}
                        </div>
                      </details>
                    ) : (
                      <DrawerMenuItem
                        disabled={action.disabled}
                        variant={action.destructive ? "destructive" : "default"}
                        onClick={() => run(action)}
                      >
                        <span className={iconSlot}>{action.icon}</span>
                        <span>{action.label}</span>
                      </DrawerMenuItem>
                    )}
                  </Fragment>
                ))}
              </DrawerMenuGroup>
            ))}
          </DrawerMenu>
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
