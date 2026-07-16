"use client";

import { useEffect, useRef, useState } from "react";
import {
  Folder,
  Star,
  Heart,
  Lock,
  Code,
  Briefcase,
  Download,
  FolderOpen,
  MoreHorizontal,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { getItemVisual } from "@/app/item-visuals";
import { ItemTypeIcon } from "@/app/item-type-icon";
import {
  DashboardItemContextMenu,
  type DashboardContextMenuGroup,
} from "@/app/dashboard-context-menu";
import { formatDateTime } from "@/app/auth-ui";
import type { FileSummary, FolderSummary } from "@/server/files/types";
import type { ShareLinkSummary } from "@/server/sharing";
import { FOLDER_ICON_MAP } from "./files-properties-panel";
import { WorkspaceActionSheet } from "../workspace-action-sheet";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MoveTarget = { id: string; pathLabel: string };

type RowShareProps = {
  share: ShareLinkSummary | null;
  targetId: string;
  targetType: "file" | "folder";
  currentPath: string;
  onShare: () => void;
};

type BaseFolderRowProps = {
  kind: "folder";
  data: FolderSummary;
  isSelected: boolean;
  selectedCount: number;
  isCut: boolean;
  isJustMoved: boolean;
  isRenaming: boolean;
  renameValue: string;
  isFavorite: boolean;
  folderIconName: string;
  availableMoveTargets: MoveTarget[];
  shareProps: RowShareProps;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onLongPress: () => void;
  onOpen: () => void;
  onStartRename: () => void;
  onFavorite: () => void;
  onTrash: () => void;
  onProperties: () => void;
  onCut: () => void;
  onMoveTo: (destinationId: string) => void;
  onDownload: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  isDropTarget: boolean;
  onMoveDragOver: (event: React.DragEvent<HTMLDivElement>) => void;
  onMoveDragLeave: (event: React.DragEvent<HTMLDivElement>) => void;
  onMoveDrop: (event: React.DragEvent<HTMLDivElement>) => void;
  rowRef: (el: HTMLDivElement | null) => void;
  touchMode: boolean;
};

type BaseFileRowProps = {
  kind: "file";
  data: FileSummary;
  isSelected: boolean;
  selectedCount: number;
  isCut: boolean;
  isJustMoved: boolean;
  isRenaming: boolean;
  renameValue: string;
  isFavorite: boolean;
  availableMoveTargets: MoveTarget[];
  shareProps: RowShareProps;
  onRenameChange: (v: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onLongPress: () => void;
  onOpen: () => void;
  onStartRename: () => void;
  onFavorite: () => void;
  onTrash: () => void;
  onProperties: () => void;
  onCut: () => void;
  onMoveTo: (destinationId: string) => void;
  onDownload: () => void;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
  touchMode: boolean;
};

type FilesRowProps = BaseFolderRowProps | BaseFileRowProps;

// ---------------------------------------------------------------------------

export function FilesRow(props: FilesRowProps) {
  const {
    isSelected,
    selectedCount,
    isCut,
    isJustMoved,
    isRenaming,
    renameValue,
    isFavorite,
    availableMoveTargets,
    shareProps,
    touchMode,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel,
    onClick,
    onLongPress,
    onOpen,
    onStartRename,
    onFavorite,
    onTrash,
    onProperties,
    onCut,
    onMoveTo,
    onDragStart,
    onDragEnd,
    rowRef,
  } = props;

  const isMultiSelected = isSelected && selectedCount > 1;

  const onDownload = props.onDownload;

  const renameInputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextClickRef = useRef(false);
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, []);

  const rowClasses = [
    "explorer-row",
    isSelected ? "is-selected" : "",
    isCut ? "is-cut" : "",
    isJustMoved ? "just-moved" : "",
    props.kind === "folder" && props.isDropTarget ? "is-drop-target" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // ---- Icon ----
  let IconComponent: LucideIcon | undefined;
  const visual = getItemVisual(
    props.kind,
    props.kind === "file" ? props.data.mimeType : null,
  );

  if (props.kind === "folder") {
    const customIcon =
      FOLDER_ICON_MAP[props.folderIconName ?? "Folder"] ?? Folder;
    IconComponent = isSelected ? FolderOpen : customIcon;
  } else {
    IconComponent = undefined;
  }

  // ---- Name ----
  const name = props.data.name;

  // ---- Meta ----
  // Format on the client only — server's timezone diverges from the browser's
  // so a render-time `Intl.DateTimeFormat` call mismatches at hydration
  // (React #418). Empty on first paint, populated on mount.
  const updatedAt = props.data.updatedAt;
  const [date, setDate] = useState("");
  useEffect(() => {
    setDate(formatDateTime(updatedAt));
  }, [updatedAt]);
  const size = props.kind === "file" ? formatBytes(props.data.sizeBytes) : "";

  // ---- Href ----
  const href =
    props.kind === "folder"
      ? props.data.isFilesRoot
        ? "/files"
        : `/files/f/${props.data.id}`
      : props.data.viewerKind
        ? `/files/view/${props.data.id}`
        : `/api/files/view/${props.data.id}/download`;

  // ---- Share display ----
  const shareLabel = shareProps.share
    ? shareProps.share.status === "active"
      ? "Shared"
      : "Link inactive"
    : null;

  const contextGroups: DashboardContextMenuGroup[] = [
    {
      actions: [
        {
          label:
            props.kind === "folder"
              ? "Open"
              : props.data.viewerKind
                ? "Open"
                : "Download",
          shortcut: "↵",
          onSelect: onOpen,
        },
        {
          hidden: !(
            isMultiSelected ||
            props.kind === "folder" ||
            props.data.viewerKind
          ),
          label: isMultiSelected
            ? `Download ${selectedCount} items as zip`
            : props.kind === "folder"
              ? "Download as zip"
              : "Download",
          onSelect: onDownload,
        },
      ],
    },
    {
      actions: [
        {
          disabled: isMultiSelected,
          label: "Rename",
          shortcut: "F2",
          onSelect: onStartRename,
        },
        {
          label: isFavorite ? "Remove from favourites" : "Add to favourites",
          onSelect: onFavorite,
        },
        {
          label: shareLabel ? "Share — manage link" : "Share",
          onSelect: shareProps.onShare,
        },
        {
          hidden: props.kind !== "folder",
          label: "Change icon…",
          onSelect: onProperties,
        },
        {
          label: "Properties",
          onSelect: onProperties,
        },
      ],
    },
    {
      actions: [
        {
          label: isMultiSelected ? `Cut ${selectedCount} items` : "Cut",
          shortcut: "⌘X",
          onSelect: onCut,
        },
        availableMoveTargets.length > 0
          ? {
              label: "Move to…",
              subActions: availableMoveTargets.map((target) => ({
                label: target.pathLabel,
                onSelect: () => onMoveTo(target.id),
              })),
            }
          : {
              disabled: true,
              label: "Move to…",
            },
      ],
    },
    {
      actions: [
        {
          destructive: true,
          label: isMultiSelected
            ? `Move ${selectedCount} items to trash`
            : "Move to trash",
          shortcut: "Del",
          onSelect: onTrash,
        },
      ],
    },
  ];

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!touchMode || event.pointerType === "mouse" || isRenaming) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, a")) return;
    clearLongPressTimer();
    suppressNextClickRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      suppressNextClickRef.current = true;
      onLongPress();
    }, 420);
  };

  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (touchMode && !isRenaming) {
      if (selectedCount > 0) onClick(event);
      else onOpen();
      return;
    }

    onClick(event);
  };

  return (
    <>
      <DashboardItemContextMenu groups={contextGroups}>
        <div
          ref={rowRef}
          data-file-row={props.data.id}
          className={rowClasses}
          draggable={!touchMode && !isRenaming}
          onClick={handleRowClick}
          onDoubleClick={touchMode ? undefined : onOpen}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={
            props.kind === "folder" ? props.onMoveDragOver : undefined
          }
          onDragLeave={
            props.kind === "folder" ? props.onMoveDragLeave : undefined
          }
          onDrop={props.kind === "folder" ? props.onMoveDrop : undefined}
          onPointerCancel={clearLongPressTimer}
          onPointerDown={handlePointerDown}
          onPointerLeave={clearLongPressTimer}
          onPointerUp={clearLongPressTimer}
          role="row"
          aria-selected={isSelected}
          tabIndex={isSelected ? 0 : -1}
        >
          {/* Icon */}
          <div className="explorer-row-icon" role="gridcell">
            <ItemTypeIcon
              icon={props.kind === "folder" ? IconComponent : undefined}
              size={16}
              tone="plain"
              visual={visual}
            />
          </div>

          {/* Name */}
          <div className="explorer-row-name-cell" role="gridcell">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="explorer-row-rename"
                value={renameValue}
                autoFocus
                onChange={(e) => onRenameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onRenameSubmit();
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    onRenameCancel();
                  }
                  // Stop propagation so row keyboard handlers don't fire
                  e.stopPropagation();
                }}
                onBlur={onRenameSubmit}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="explorer-row-name" title={name}>
                  {name}
                </span>
                {shareProps.share?.status === "active" && (
                  <Share2
                    size={10}
                    className="explorer-row-share-badge"
                    aria-label="Shared"
                  />
                )}
              </>
            )}
          </div>

          {/* Size */}
          <span className="explorer-row-meta" role="gridcell">
            {size}
          </span>

          {/* Date */}
          <span
            className="explorer-row-meta"
            role="gridcell"
            suppressHydrationWarning
          >
            {date}
          </span>

          <button
            aria-label={`Actions for ${name}`}
            className="explorer-row-mobile-action"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setActionSheetOpen(true);
            }}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
        </div>
      </DashboardItemContextMenu>
      <WorkspaceActionSheet
        groups={contextGroups}
        itemName={name}
        open={actionSheetOpen}
        onOpenChange={setActionSheetOpen}
      />
    </>
  );
}
