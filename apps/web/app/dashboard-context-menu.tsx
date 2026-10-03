"use client";

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
import { useRouter } from "next/navigation";
import { submitStorageMutationPost } from "@/app/storage-mutation-submit";
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
} from "@/components/ui/context-menu";

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

export function DashboardItemContextMenu({
  children,
  groups,
}: {
  children: ReactElement;
  groups: DashboardContextMenuGroup[];
}) {
  const trigger = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        [ITEM_CONTEXT_TRIGGER_ATTR]: "",
      })
    : children;

  return (
    <ContextMenu>
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

export function submitDashboardPostForm({
  action,
  confirmMessage,
  fields,
}: {
  action: string;
  confirmMessage?: string;
  fields?: Record<string, string>;
}) {
  if (confirmMessage && !window.confirm(confirmMessage)) return;
  void submitStorageMutationPost({
    action,
    fields,
    logicalAction: `dashboard:${action}:${JSON.stringify(fields ?? {})}`,
  })
    .then(() => {
      window.location.href = fields?.redirectTo ?? window.location.href;
    })
    .catch((error) =>
      window.alert(
        error instanceof Error ? error.message : "Storage operation failed.",
      ),
    );
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
  const router = useRouter();
  const groups: DashboardContextMenuGroup[] = [
    {
      actions: [
        {
          icon: <RefreshCw size={13} />,
          label: "Refresh",
          onSelect: () => router.refresh(),
        },
        {
          hidden: preset === "shared" || preset === "trash",
          icon: <FolderOpen size={13} />,
          label: "Open files",
          onSelect: () => router.push("/files"),
        },
        {
          hidden: preset !== "shared",
          label: "New share link",
          onSelect: () => router.push("/files"),
        },
        {
          destructive: true,
          disabled: isTrashEmpty,
          hidden: preset !== "trash",
          label: "Empty trash",
          onSelect: () =>
            submitDashboardPostForm({
              action: "/api/files/trash/clear",
              confirmMessage:
                "Empty trash? This permanently deletes all trashed folder trees and standalone files.",
              fields: { redirectTo: "/trash" },
            }),
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
