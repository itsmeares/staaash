"use client";

import { Fragment } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="workspace-bottom-sheet workspace-action-sheet"
        showCloseButton={false}
        onSwipeClose={() => onOpenChange(false)}
      >
        <div
          className="workspace-bottom-sheet-handle"
          data-bottom-sheet-drag-handle
          aria-hidden
        />
        <div className="workspace-action-sheet-head">
          <DialogTitle className="workspace-action-sheet-title">
            {title}
          </DialogTitle>
          {itemName ? (
            <p className="workspace-action-sheet-subtitle">{itemName}</p>
          ) : null}
        </div>

        <div className="workspace-action-sheet-groups">
          {visibleGroups.map((group, groupIndex) => (
            <div className="workspace-action-sheet-group" key={groupIndex}>
              {group.actions.map((action) => (
                <Fragment key={action.label}>
                  {action.subActions && action.subActions.length > 0 ? (
                    <details className="workspace-action-sheet-details">
                      <summary
                        className={`workspace-action-sheet-item${action.disabled ? " is-disabled" : ""}`}
                      >
                        <span className="workspace-action-sheet-icon">
                          {action.icon}
                        </span>
                        <span>{action.label}</span>
                      </summary>
                      <div className="workspace-action-sheet-subitems">
                        {getVisibleDashboardMenuGroups([
                          { actions: action.subActions },
                        ])[0]?.actions.map((subAction) => (
                          <button
                            className="workspace-action-sheet-subitem"
                            disabled={subAction.disabled}
                            key={subAction.label}
                            type="button"
                            onClick={() => runAction(subAction)}
                          >
                            {subAction.label}
                          </button>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <button
                      className={`workspace-action-sheet-item${action.destructive ? " is-destructive" : ""}`}
                      disabled={action.disabled}
                      type="button"
                      onClick={() => runAction(action)}
                    >
                      <span className="workspace-action-sheet-icon">
                        {action.icon}
                      </span>
                      <span>{action.label}</span>
                      {action.shortcut ? (
                        <span className="workspace-action-sheet-shortcut">
                          {action.shortcut}
                        </span>
                      ) : null}
                    </button>
                  )}
                </Fragment>
              ))}
            </div>
          ))}
        </div>

        <button
          className="workspace-action-sheet-cancel"
          type="button"
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </button>
      </DialogContent>
    </Dialog>
  );
}
