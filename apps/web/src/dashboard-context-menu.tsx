import { useNavigate } from "@tanstack/react-router";
import { useRefresh } from "@/lib/use-refresh";
import {
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useMemo,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { submitStorageMutationPost } from "@/src/storage-mutation-submit";
import { confirmAction } from "@/components/confirm-dialog";
import { toast } from "@staaash/ui/components/toast";
import { FolderOpen, RefreshCw } from "lucide-react";

import {
  ContextMenu,
  ContextMenuPopup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubPopup,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@staaash/ui/components/context-menu";

import {
  MenuItem,
  MenuSeparator,
  MenuShortcut,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "@staaash/ui/components/menu";

import {
  getVisibleDashboardMenuGroups,
  type DashboardContextMenuActionModel,
  type DashboardContextMenuGroupModel,
} from "./dashboard-context-menu-model";

const ITEM_CONTEXT_TRIGGER_ATTR = "data-dashboard-item-context-trigger";

export type DashboardContextMenuAction = DashboardContextMenuActionModel & {
  icon?: ReactNode;
  label: string;
  onSelect?: () => void;
  shortcut?: string;
  destructive?: boolean;
  /** A short name for the phone sheet's big buttons, when it gets one. */
  quick?: string;
  subActions?: DashboardContextMenuAction[];
};

export type DashboardContextMenuGroup =
  DashboardContextMenuGroupModel<DashboardContextMenuAction>;

type DashboardContextMenuItemsProps = {
  groups: DashboardContextMenuGroup[];
};

function DashboardContextMenuItems({ groups }: DashboardContextMenuItemsProps) {
  const visibleGroups = getVisibleDashboardMenuGroups(groups);

  return (
    <>
      {visibleGroups.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {groupIndex > 0 ? <ContextMenuSeparator /> : null}
          {group.actions.map((action) => (
            <Fragment key={action.label}>
              {action.subActions && action.subActions.length > 0 ? (
                <ContextMenuSub>
                  <ContextMenuSubTrigger>
                    {action.icon}
                    {action.label}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubPopup>
                    <DashboardContextMenuItems
                      groups={[{ actions: action.subActions }]}
                    />
                  </ContextMenuSubPopup>
                </ContextMenuSub>
              ) : (
                <ContextMenuItem
                  disabled={action.disabled}
                  variant={action.destructive ? "destructive" : "default"}
                  onClick={() => {
                    if (action.disabled) return;
                    action.onSelect?.();
                  }}
                >
                  {action.icon}
                  {action.label}
                  {action.shortcut ? (
                    <ContextMenuShortcut>{action.shortcut}</ContextMenuShortcut>
                  ) : null}
                </ContextMenuItem>
              )}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/** The same actions in a dropdown menu, for "More actions" buttons. */
export function DashboardMenuItems({ groups }: DashboardContextMenuItemsProps) {
  const visibleGroups = getVisibleDashboardMenuGroups(groups);

  return (
    <>
      {visibleGroups.map((group, groupIndex) => (
        <Fragment key={groupIndex}>
          {groupIndex > 0 ? <MenuSeparator /> : null}
          {group.actions.map((action) =>
            action.subActions && action.subActions.length > 0 ? (
              <MenuSub key={action.label}>
                <MenuSubTrigger>
                  {action.icon}
                  {action.label}
                </MenuSubTrigger>
                <MenuSubPopup>
                  <DashboardMenuItems
                    groups={[{ actions: action.subActions }]}
                  />
                </MenuSubPopup>
              </MenuSub>
            ) : (
              <MenuItem
                disabled={action.disabled}
                key={action.label}
                variant={action.destructive ? "destructive" : "default"}
                onClick={() => {
                  if (!action.disabled) action.onSelect?.();
                }}
              >
                {action.icon}
                {action.label}
                {action.shortcut ? (
                  <MenuShortcut>{action.shortcut}</MenuShortcut>
                ) : null}
              </MenuItem>
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

export function DashboardItemContextMenu({
  children,
  disabled,
  groups,
}: {
  children: ReactElement;
  disabled?: boolean;
  groups: DashboardContextMenuGroup[];
}) {
  const trigger = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        [ITEM_CONTEXT_TRIGGER_ATTR]: "",
      })
    : children;

  return (
    <ContextMenu disabled={disabled}>
      <ContextMenuTrigger render={trigger} />
      <ContextMenuPopup>
        <DashboardContextMenuItems groups={groups} />
      </ContextMenuPopup>
    </ContextMenu>
  );
}

type DashboardPageContextMenuProps = HTMLAttributes<HTMLDivElement> & {
  groups: DashboardContextMenuGroup[];
  ignoreSelector?: string;
};

export function DashboardPageContextMenu({
  children,
  groups,
  ignoreSelector,
  ...props
}: DashboardPageContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );

  useEffect(() => {
    const onDocumentContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest("[data-workspace-content]")) return;
      if (target.closest(`[${ITEM_CONTEXT_TRIGGER_ATTR}]`)) return;
      if (ignoreSelector && target.closest(ignoreSelector)) return;

      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY });
    };

    document.addEventListener("contextmenu", onDocumentContextMenu);
    return () =>
      document.removeEventListener("contextmenu", onDocumentContextMenu);
  }, [ignoreSelector]);

  const anchor = useMemo(
    () =>
      position
        ? {
            getBoundingClientRect: () =>
              DOMRect.fromRect({ x: position.x, y: position.y }),
          }
        : undefined,
    [position],
  );

  return (
    <>
      <div {...props}>{children}</div>

      <ContextMenu
        open={position !== null}
        onOpenChange={(open) => {
          if (!open) setPosition(null);
        }}
      >
        <ContextMenuPopup align="start" anchor={anchor} sideOffset={0}>
          <DashboardContextMenuItems groups={groups} />
        </ContextMenuPopup>
      </ContextMenu>
    </>
  );
}

export const EMPTY_TRASH_CONFIRM = {
  title: "Empty trash?",
  description: "Everything in it is deleted for good.",
  confirmLabel: "Empty trash",
  destructive: true,
};

export async function emptyTrash(refresh: () => Promise<unknown>) {
  if (!(await confirmAction(EMPTY_TRASH_CONFIRM))) return;
  try {
    await submitStorageMutationPost({
      action: "/api/files/trash/clear",
      logicalAction: "dashboard:empty-trash",
    });
    await refresh();
  } catch (error) {
    toast.error(
      error instanceof Error ? error.message : "Storage operation failed.",
    );
  }
}

export function WorkspacePresetPageContextMenu({
  children,
  isTrashEmpty,
  preset,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  isTrashEmpty?: boolean;
  preset: "home" | "search" | "shared" | "trash";
}) {
  const navigate = useNavigate();
  const refresh = useRefresh();
  const groups: DashboardContextMenuGroup[] = [
    {
      actions: [
        {
          icon: <RefreshCw size={13} />,
          label: "Refresh",
          onSelect: () => void refresh(),
        },
        {
          hidden: preset === "shared" || preset === "trash",
          icon: <FolderOpen size={13} />,
          label: "Open files",
          onSelect: () => void navigate({ href: "/files" }),
        },
        {
          hidden: preset !== "shared",
          label: "New share link",
          onSelect: () => void navigate({ href: "/files" }),
        },
        {
          destructive: true,
          disabled: isTrashEmpty,
          hidden: preset !== "trash",
          label: "Empty trash",
          onSelect: () => void emptyTrash(refresh),
        },
      ],
    },
  ];

  return (
    <DashboardPageContextMenu groups={groups} {...props}>
      {children}
    </DashboardPageContextMenu>
  );
}
