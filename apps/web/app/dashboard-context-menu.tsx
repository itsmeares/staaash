"use client";

import {
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { FolderOpen, RefreshCw } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
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
  onActionSelected?: () => void;
};

function DashboardContextMenuItems({
  groups,
  onActionSelected,
}: DashboardContextMenuItemsProps) {
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
                  <ContextMenuSubContent>
                    <DashboardContextMenuItems
                      groups={[{ actions: action.subActions }]}
                      onActionSelected={onActionSelected}
                    />
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : (
                <ContextMenuItem
                  disabled={action.disabled}
                  variant={action.destructive ? "destructive" : "default"}
                  onClick={() => {
                    if (action.disabled) return;
                    action.onSelect?.();
                    onActionSelected?.();
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

function DashboardFloatingMenuItems({
  groups,
  onActionSelected,
}: DashboardContextMenuItemsProps) {
  const visibleGroups = getVisibleDashboardMenuGroups(groups);

  return (
    <>
      {visibleGroups.map((group, groupIndex) => (
        <div key={groupIndex}>
          {groupIndex > 0 ? <div className="bg-ctx-sep" /> : null}
          {group.actions.map((action) => (
            <button
              className={`bg-ctx-item${action.destructive ? " bg-ctx-item--danger" : ""}`}
              disabled={action.disabled}
              key={action.label}
              type="button"
              onClick={() => {
                if (action.disabled) return;
                action.onSelect?.();
                onActionSelected?.();
              }}
            >
              {action.icon}
              {action.label}
              {action.shortcut ? (
                <span className="bg-ctx-shortcut">{action.shortcut}</span>
              ) : null}
            </button>
          ))}
        </div>
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
      <ContextMenuContent>
        <DashboardContextMenuItems groups={groups} />
      </ContextMenuContent>
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocumentContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;

      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".workspace-content")) return;
      if (target.closest(`[${ITEM_CONTEXT_TRIGGER_ATTR}]`)) return;
      if (ignoreSelector && target.closest(ignoreSelector)) return;

      event.preventDefault();
      setPosition({ x: event.clientX, y: event.clientY });
    };

    document.addEventListener("contextmenu", onDocumentContextMenu);
    return () =>
      document.removeEventListener("contextmenu", onDocumentContextMenu);
  }, [ignoreSelector]);

  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [position]);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) return;
    const { width, height } = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const x = Math.max(
      pad,
      Math.min(position.x, window.innerWidth - width - pad),
    );
    const y = Math.max(
      pad,
      Math.min(position.y, window.innerHeight - height - pad),
    );
    if (x !== position.x || y !== position.y) setPosition({ x, y });
  }, [position]);

  return (
    <>
      <div {...props}>{children}</div>

      {position
        ? createPortal(
            <div
              ref={menuRef}
              className="bg-ctx-menu"
              style={{ top: position.y, left: position.x }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DashboardFloatingMenuItems
                groups={groups}
                onActionSelected={() => setPosition(null)}
              />
            </div>,
            document.body,
          )
        : null}
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

  const form = document.createElement("form");
  form.method = "post";
  form.action = action;

  for (const [name, value] of Object.entries(fields ?? {})) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }

  document.body.appendChild(form);
  form.submit();
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
