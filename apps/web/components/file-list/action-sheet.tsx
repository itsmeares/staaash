"use client";

import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerFooter,
  DrawerHeader,
  DrawerMenu,
  DrawerMenuGroup,
  DrawerMenuItem,
  DrawerMenuSeparator,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { getVisibleDashboardMenuGroups } from "@/app/dashboard-context-menu-model";
import type { DashboardContextMenuGroup } from "@/app/dashboard-context-menu";

type WorkspaceActionSheetProps = {
  groups: DashboardContextMenuGroup[];
  itemName?: string;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title?: string;
};

export function WorkspaceActionSheet({
  groups,
  itemName,
  onOpenChange,
  open,
  title = "Actions",
}: WorkspaceActionSheetProps) {
  const visibleGroups = getVisibleDashboardMenuGroups(groups);

  const runAction = (action: { disabled?: boolean; onSelect?: () => void }) => {
    if (action.disabled) return;
    action.onSelect?.();
    onOpenChange(false);
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerPopup showBar>
        <DrawerHeader className="gap-0.5">
          <DrawerTitle>{title}</DrawerTitle>
          {itemName ? (
            <p className="truncate text-xs text-muted-foreground">{itemName}</p>
          ) : null}
        </DrawerHeader>

        <DrawerPanel>
          <DrawerMenu>
            {visibleGroups.map((group, groupIndex) => (
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
                          <span className="inline-flex w-4.5 justify-center text-muted-foreground">
                            {action.icon}
                          </span>
                          <span>{action.label}</span>
                        </DrawerMenuItem>
                        <div className="grid gap-1 ps-10 pt-1.5 pb-0.5">
                          {getVisibleDashboardMenuGroups([
                            { actions: action.subActions },
                          ])[0]?.actions.map((subAction) => (
                            <DrawerMenuItem
                              disabled={subAction.disabled}
                              key={subAction.label}
                              onClick={() => runAction(subAction)}
                            >
                              {subAction.label}
                            </DrawerMenuItem>
                          ))}
                        </div>
                      </details>
                    ) : (
                      <DrawerMenuItem
                        disabled={action.disabled}
                        variant={action.destructive ? "destructive" : "default"}
                        onClick={() => runAction(action)}
                      >
                        <span className="inline-flex w-4.5 justify-center text-muted-foreground">
                          {action.icon}
                        </span>
                        <span>{action.label}</span>
                        {action.shortcut ? (
                          <span className="ms-auto text-xs text-muted-foreground">
                            {action.shortcut}
                          </span>
                        ) : null}
                      </DrawerMenuItem>
                    )}
                  </Fragment>
                ))}
              </DrawerMenuGroup>
            ))}
          </DrawerMenu>
        </DrawerPanel>

        <DrawerFooter variant="bare">
          <DrawerClose render={<Button className="w-full" variant="ghost" />}>
            Cancel
          </DrawerClose>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
}
